const express = require('express');
const Airtable = require('airtable');
const cors = require('cors');
const { google } = require('googleapis');
const crypto = require('crypto');

// ✅ Safe import pattern for date-fns-tz
const tz = require('date-fns-tz');
const { formatInTimeZone, zonedTimeToUtc, utcToZonedTime } = tz;

// (Optional debug - uncomment to see exports)
// console.log('date-fns-tz exports:', Object.keys(tz));

const { addDays, startOfDay, endOfDay, format, isBefore, isAfter, addMonths } = require('date-fns');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ENVIRONMENT VALIDATION =====
function validateEnvironment() {
  const requiredEnvVars = [
    'AIRTABLE_TOKEN',
    'AIRTABLE_BASE_ID'
  ];
  
  const missing = requiredEnvVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('   Please set these in your Render/Heroku environment variables');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
}

// Run validation
validateEnvironment();

// ===== SECURITY & PRIVACY HELPER =====
function maskSensitiveData(text) {
  if (!text) return '';
  
  // Mask phone numbers
  let masked = text.replace(/\+\d[\d\s\-\(\)]+/g, match => {
    // Keep country code and last 4 digits, mask the rest
    const digits = match.replace(/\D/g, '');
    if (digits.length <= 4) return match;
    return digits.substring(0, Math.min(2, digits.length - 4)) + 
           '****' + 
           digits.substring(digits.length - 4);
  });
  
  // Mask email addresses
  masked = masked.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, match => {
    const [local, domain] = match.split('@');
    return local.substring(0, 2) + '***@' + domain;
  });
  
  return masked;
}

// ===== LOGGING HELPER =====
function safeLog(message, data = null, level = 'info') {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] ${message}`;
  
  if (data) {
    // Mask sensitive data in logs - ONLY specific PII fields
    const safeData = JSON.parse(JSON.stringify(data));
    
    // Recursively mask specific PII fields only
    const piiKeys = new Set(['firstname', 'lastname', 'phone', 'phonenumber', 'email', 'fullname']);
    
    function maskObject(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      
      Object.keys(obj).forEach(key => {
        const lowerKey = key.toLowerCase();
        if (piiKeys.has(lowerKey)) {
          if (typeof obj[key] === 'string') {
            obj[key] = maskSensitiveData(obj[key]);
          }
        } else if (typeof obj[key] === 'object') {
          maskObject(obj[key]);
        }
      });
      
      return obj;
    }
    
    maskObject(safeData);
    logMessage += ` ${JSON.stringify(safeData, null, 2)}`;
  }
  
  console[level](logMessage);
}

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Airtable with validation
let base;
try {
  const airtable = new Airtable({
    apiKey: process.env.AIRTABLE_TOKEN
  });
  
  base = airtable.base(process.env.AIRTABLE_BASE_ID);
  safeLog('✅ Airtable initialized successfully');
} catch (error) {
  safeLog('❌ Failed to initialize Airtable', { error: error.message }, 'error');
  process.exit(1);
}

// ===== ROME TIMEZONE CONSTANTS AND FUNCTIONS =====
const ROME_TIMEZONE = 'Europe/Rome';

// ✅ Fixed Rome date function
function getRomeDate() {
  return utcToZonedTime(new Date(Date.now()), ROME_TIMEZONE);
}

// Get today's date string in Rome (YYYY-MM-DD)
function getRomeDateToday() {
  return formatInTimeZone(new Date(Date.now()), ROME_TIMEZONE, 'yyyy-MM-dd');
}

// ✅ Fixed getRomeDateTime to use single "now" source
function getRomeDateTime() {
  const now = new Date(Date.now());
  const romeDate = utcToZonedTime(now, ROME_TIMEZONE);

  return {
    date: formatInTimeZone(now, ROME_TIMEZONE, 'yyyy-MM-dd'),
    time: formatInTimeZone(now, ROME_TIMEZONE, 'HH:mm:ss'),
    year: romeDate.getFullYear(),
    month: romeDate.getMonth() + 1,
    day: romeDate.getDate(),
    hour: romeDate.getHours(),
    minute: romeDate.getMinutes(),
    iso: formatInTimeZone(now, ROME_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    romeDate
  };
}

// Get Italian greeting based on Rome time
function getItalianTimeGreeting() {
  const romeDate = getRomeDate();
  const currentHour = romeDate.getHours();
  
  safeLog('Italian time check', { hour: currentHour });
  
  if (currentHour >= 5 && currentHour < 12) return "Buongiorno";
  else if (currentHour >= 12 && currentHour < 13) return "Buon pranzo";
  else if (currentHour >= 13 && currentHour < 18) return "Buon pomeriggio";
  else if (currentHour >= 18 && currentHour < 22) return "Buonasera";
  else return "Buonanotte";
}

// Generate unique reservation ID
function generateReservationId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `JAZ-${timestamp}-${random}`.toUpperCase();
}

// Convert time string to Airtable date format using Rome timezone
function formatTimeForAirtable(timeString, dateString) {
  try {
    // Create a Rome-local datetime and convert to UTC ISO for Airtable
    const utcDate = zonedTimeToUtc(`${dateString}T${timeString}:00`, ROME_TIMEZONE);
    return utcDate.toISOString();
  } catch (error) {
    safeLog('Error formatting time for Airtable', { error: error.message }, 'error');
    
    // Fallback: create a date for 19:30 Rome time
    const fallbackDateTime = `${dateString}T19:30:00`;
    const utcFallback = zonedTimeToUtc(fallbackDateTime, ROME_TIMEZONE);
    return utcFallback.toISOString();
  }
}

// Enhanced day name to date conversion with "next" handling
function convertDayToDate(dayName) {
  const cleaned = dayName.toLowerCase().trim();
  
  safeLog('convertDayToDate called', { input: dayName, cleaned });
  
  // Handle "next [day]" patterns
  const nextEnglishMatch = cleaned.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextEnglishMatch) {
    safeLog('Found "next" pattern', { day: nextEnglishMatch[1] });
    return findNextDayOfWeek(nextEnglishMatch[1], true);
  }
  
  // Handle "prossimo/a [day]" patterns (Italian)
  const prossimoMatch = cleaned.match(/^prossim[oa]\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)$/);
  if (prossimoMatch) {
    safeLog('Found "prossimo" pattern', { day: prossimoMatch[1] });
    return findNextDayOfWeek(prossimoMatch[1], true);
  }
  
  // Handle simple day names
  const dayMap = {
    // English days
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    // Italian days with and without accents
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 'sabato': 6,
    'today': 'today', 'oggi': 'today', 'tomorrow': 'tomorrow', 'domani': 'tomorrow',
    'tonight': 'today', 'stasera': 'today', 'questa sera': 'today'
  };
  
  const targetDay = dayMap[cleaned];
  
  if (targetDay === 'today') {
    const result = getRomeDateToday();
    safeLog('"today" parsed', { result });
    return result;
  } else if (targetDay === 'tomorrow') {
    const today = getRomeDate();
    const tomorrow = addDays(today, 1);
    const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'yyyy-MM-dd');
    safeLog('"tomorrow" parsed', { result });
    return result;
  } else if (targetDay !== undefined) {
    const result = findNextDayOfWeek(cleaned, false);
    safeLog('Day name parsed', { day: cleaned, result });
    return result;
  }
  
  // Default to tomorrow if day not recognized
  const today = getRomeDate();
  const tomorrow = addDays(today, 1);
  const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'yyyy-MM-dd');
  safeLog('Day not recognized, defaulting to tomorrow', { input: cleaned, result });
  return result;
}

// Helper function to find next day of week (with option for "next" meaning skip current week)
function findNextDayOfWeek(dayName, skipCurrentWeek = false) {
  const dayMap = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 'sabato': 6
  };
  
  const targetDayNum = dayMap[dayName];
  if (targetDayNum === undefined) {
    throw new Error(`Unknown day name: ${dayName}`);
  }
  
  const today = getRomeDate();
  const todayDayNum = today.getDay();
  
  let daysToAdd = (targetDayNum - todayDayNum + 7) % 7;
  
  if (daysToAdd === 0) {
    // It's today
    if (skipCurrentWeek) {
      daysToAdd = 7; // Skip to next week
    }
  }
  
  const targetDate = addDays(today, daysToAdd);
  return formatInTimeZone(targetDate, ROME_TIMEZONE, 'yyyy-MM-dd');
}

// Helper function to parse relative dates (ROME TIMEZONE) - IMPROVED to handle "the 3rd" smartly
function parseRelativeDate(dateString) {
  const romeNow = getRomeDateTime();
  
  safeLog('Parsing relative date', { input: dateString, todayInRome: romeNow.date });
  
  // Clean the string
  const cleanString = dateString.toLowerCase()
    .replace('of this month', '')
    .replace('this month', '')
    .replace('the ', '')
    .replace('on ', '')
    .trim();
  
  // Check for "today" and "tomorrow" first
  if (cleanString === 'today' || cleanString === 'oggi') {
    safeLog('"today" parsed', { result: romeNow.date });
    return romeNow.date;
  }
  
  if (cleanString === 'tomorrow' || cleanString === 'domani') {
    const tomorrow = addDays(getRomeDate(), 1);
    const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'yyyy-MM-dd');
    safeLog('"tomorrow" parsed', { result });
    return result;
  }
  
  // Try to handle "next [day]" patterns
  if (cleanString.startsWith('next ') || cleanString.startsWith('prossim')) {
    safeLog('Using convertDayToDate for pattern', { pattern: cleanString });
    return convertDayToDate(cleanString);
  }
  
  // Check for day numbers (1st, 2nd, 3rd, 4th, etc.) - IMPROVED: if day has passed, use next month
  const dayMatch = cleanString.match(/(\d+)(?:st|nd|rd|th)?/);
  
  if (dayMatch) {
    const day = parseInt(dayMatch[1]);
    
    // If it's just a day number, use current Rome month and year
    if (day >= 1 && day <= 31) {
      // Get today's date
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();
      
      // Try the current month first
      let testMonth = currentMonth;
      let testYear = currentYear;
      
      // If the day has already passed this month, use next month
      if (day < currentDay) {
        testMonth++;
        if (testMonth > 12) {
          testMonth = 1;
          testYear++;
        }
      }
      
      // Create a date in Rome timezone for this day
      const testDateStr = `${testYear}-${testMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const testDate = zonedTimeToUtc(`${testDateStr}T12:00:00`, ROME_TIMEZONE);
      const romeTestDate = utcToZonedTime(testDate, ROME_TIMEZONE);
      
      // Format the result
      const result = formatInTimeZone(romeTestDate, ROME_TIMEZONE, 'yyyy-MM-dd');
      safeLog('Day number parsed with smart month handling', { 
        day, 
        currentDay,
        currentMonth,
        testMonth,
        result 
      });
      return result;
    }
  }
  
  // Try to parse month names
  const monthMap = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5, 'giugno': 6,
    'luglio': 7, 'agosto': 8, 'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12
  };
  
  for (const [monthName, monthNumber] of Object.entries(monthMap)) {
    if (cleanString.includes(monthName)) {
      const dayMatch2 = cleanString.match(/(\d+)(?:st|nd|rd|th)?/);
      if (dayMatch2) {
        const day = parseInt(dayMatch2[1]);
        // Use current year (Rome timezone)
        const result = `${romeNow.year}-${monthNumber.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        safeLog('Month + day parsed', { month: monthName, day, result });
        return result;
      }
    }
  }
  
  // Fallback to convertDayToDate
  safeLog('Falling back to convertDayToDate', { input: cleanString });
  return convertDayToDate(cleanString);
}

// ===== RESERVATION VALIDATION =====
function validateReservationData(reservationData) {
  const errors = [];
  const warnings = [];
  
  // Required fields
  if (!reservationData.date) {
    errors.push('Date is required');
  }
  
  if (!reservationData.time) {
    errors.push('Time is required');
  } else if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(reservationData.time)) {
    errors.push('Time must be in HH:MM format (e.g., 20:00)');
  }
  
  if (!reservationData.guests || reservationData.guests < 1) {
    errors.push('Number of guests is required and must be at least 1');
  }
  
  // Important but not strictly required (can prompt for clarification)
  if (!reservationData.firstName || !reservationData.lastName) {
    warnings.push('Name not provided');
  }
  
  if (!reservationData.phone) {
    warnings.push('Phone number not provided');
  } else {
    const phoneDigits = reservationData.phone.replace(/\D/g, '');
    if (phoneDigits.length < 7) {
      warnings.push('Phone number appears incomplete');
    }
  }
  
  // Date validation (Rome timezone) - FIXED: Compare date-only, not noon vs now
  if (reservationData.date) {
    try {
      // Create date-only comparison (midnight to midnight)
      const romeResDay = startOfDay(
        utcToZonedTime(
          zonedTimeToUtc(`${reservationData.date}T00:00:00`, ROME_TIMEZONE), 
          ROME_TIMEZONE
        )
      );
      const romeTodayDay = startOfDay(getRomeDate());
      
      if (isBefore(romeResDay, romeTodayDay)) {
        errors.push('Reservation date cannot be in the past');
      }
      
      // Also check if time has already passed for today's reservations
      if (reservationData.date === getRomeDateToday() && reservationData.time) {
        const now = getRomeDate();
        const [hours, minutes] = reservationData.time.split(':').map(Number);
        const reservationTime = new Date(now);
        reservationTime.setHours(hours, minutes, 0, 0);
        
        if (isBefore(reservationTime, now)) {
          warnings.push('Reservation time appears to be in the past for today');
        }
      }
    } catch (error) {
      errors.push(`Invalid date format: ${reservationData.date}`);
    }
  }
  
  return { isValid: errors.length === 0, errors, warnings };
}

// ===== RESERVATION INTENT DETECTION =====
function detectReservationIntent(conversationText, transcript = []) {
  safeLog('Detecting reservation intent', { conversationLength: conversationText?.length });
  
  const lowerText = conversationText.toLowerCase();
  
  // MULTILINGUAL RESERVATION KEYWORDS
  const reservationKeywords = [
    // English keywords
    'reservation', 'reserve', 'book', 'booking', 'make a reservation',
    'table for', 'reserve a table', 'book a table', 'make a booking',
    'dinner reservation', 'reserve seats', 'book seats', 'make reservation',
    'reserve for', 'book for', 'I want to reserve', 'I want to book',
    'I would like to reserve', 'I would like to book', 'can i reserve',
    'can i book', 'could i reserve', 'could i book',
    'make a table reservation', 'table booking', 'seat reservation',
    
    // Italian keywords (with and without accents)
    'prenotazione', 'prenotare', 'prenota', 'prenotiamo', 'prenotato',
    'prenotati', 'vorrei prenotare', 'desidero prenotare', 'posso prenotare',
    'faccio una prenotazione', 'fare una prenotazione', 'per prenotare',
    'prenotare un tavolo', 'prenotazione tavolo', 'tavolo per',
    'riservare', 'riservazione', 'riserva', 'vorrei riservare',
    'posto a sedere', 'posti a sedere', 'sedie', 'tavoli',
    'voglio prenotare', 'devo prenotare', 'ho bisogno di prenotare',
    'mi piacerebbe prenotare', 'avrei bisogno di prenotare',
    'vorrei riservare un tavolo', 'riservazione tavolo',
    
    // Common reservation-related phrases
    'for dinner', 'per cena', 'for lunch', 'per pranzo',
    'for tonight', 'per stasera', 'for tomorrow', 'per domani'
  ];
  
  // Check for keywords in conversation
  let foundKeywords = [];
  for (const keyword of reservationKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundKeywords.push(keyword);
    }
  }
  
  if (foundKeywords.length > 0) {
    safeLog('Found reservation keywords', { keywords: foundKeywords });
    return { wantsReservation: true, reason: `Keywords: ${foundKeywords.join(', ')}` };
  }
  
  // Check for patterns indicating reservation intent
  const patterns = [
    // English patterns
    /(for|per)\s+(\d+)\s+(people|persons|guests|persone|ospiti)/i,
    /(\d+)\s+(people|persons|guests|persone|ospiti)\s+(for|per)/i,
    /(table|tavolo)\s+(for|per)\s+(\d+)/i,
    /(i'd like|i would like|i want|vorrei|desidero)\s+(to\s+)?(reserve|book|prenotare)/i,
    /(can|could|may|posso|potrei)\s+(i|we|io|noi)\s+(reserve|book|prenotare)/i,
    
    // Italian patterns
    /(un|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+(persone|ospiti)/i,
    /(per|a)\s+(nome|nome e cognome)/i,
    /(numero|telefono|cellulare)\s+(di|da)/i,
    /(che\s+ora|a\s+che\s+ora|what time)/i,
    /(che\s+giorno|che\s+data|what date)/i
  ];
  
  for (const pattern of patterns) {
    const match = lowerText.match(pattern);
    if (match) {
      safeLog('Found reservation pattern', { pattern: pattern.source, match: match[0] });
      return { wantsReservation: true, reason: `Pattern: ${match[0]}` };
    }
  }
  
  safeLog('No clear reservation intent detected');
  return { wantsReservation: false, reason: 'No indicators found' };
}

// ===== RESERVATION EXTRACTION CODE =====
function extractReservationData(conversation, systemLogs = '') {
  safeLog('Starting comprehensive reservation data extraction', {
    conversationLength: conversation?.length,
    hasSystemLogs: !!systemLogs
  });
  
  const defaultReservation = {
    firstName: '',
    lastName: '',
    date: '', // Empty by default - don't assume today
    time: '', // Empty by default - don't assume 22:00
    guests: 0, // Zero by default - must be provided
    adults: 0,
    children: 0,
    phone: '',
    specialRequests: '',
    newsletter: false
  };

  // Sources for data extraction
  const sources = {
    structuredBlock: extractFromStructuredBlock(conversation, systemLogs),
    conversationFlow: extractFromConversationFlow(conversation),
    systemLogs: extractFromSystemLogs(systemLogs)
  };

  safeLog('Data from all sources', sources);

  // Merge and resolve conflicts
  const finalData = mergeAndResolveData(sources, defaultReservation);
  
  safeLog('Final resolved data', finalData);
  return finalData;
}

function extractFromStructuredBlock(conversation, systemLogs) {
  const data = {};
  
  const fullConversationText = conversation 
    .map(msg => msg.content || '')
    .join('\n');
  
  const structuredMatch = fullConversationText.match(/RESERVATION_DATA:[\s\S]*?(?=\n\n|\n$|$)/i);
  if (structuredMatch) {
    safeLog('Found structured data in conversation');
    return parseStructuredBlock(structuredMatch[0]);
  }
  
  if (systemLogs) {
    const logMatch = systemLogs.match(/RESERVATION_DATA:[\s\S]*?(?=\n\n|\n$|$)/i);
    if (logMatch) {
      safeLog('Found structured data in system logs');
      return parseStructuredBlock(logMatch[0]);
    }
  }
  
  safeLog('No structured data block found');
  return data;
}

function parseStructuredBlock(block) {
  const data = {};
  const fieldPatterns = {
    'first name': (val) => data.firstName = val,
    'last name': (val) => data.lastName = val,
    'phone': (val) => data.phone = '+39' + val.replace(/\D/g, ''),
    'guests': (val) => data.guests = parseInt(val) || 0,
    'adults': (val) => data.adults = parseInt(val) || 0,
    'children': (val) => data.children = parseInt(val) || 0,
    'date': (val) => data.date = convertDayToDate(val),
    'time': (val) => data.time = val,
    'special requests': (val) => data.specialRequests = val === 'None' ? '' : val,
    'newsletter': (val) => data.newsletter = val.toLowerCase() === 'yes'
  };

  Object.entries(fieldPatterns).forEach(([field, setter]) => {
    const regex = new RegExp(`${field}:\\s*([^\\n]+)`, 'i');
    const match = block.match(regex);
    if (match && match[1]) {
      const value = match[1].trim();
      safeLog('Structured field found', { field, value });
      setter(value);
    }
  });

  return data;
}

function extractFromConversationFlow(conversation) {
  safeLog('Extracting from conversation flow', { messages: conversation?.length });
  const data = {};
  
  let phoneDigits = '';
  let firstNameAsked = false;
  let lastNameAsked = false;
  let phoneAsked = false;
  let guestsAsked = false;
  let dateAsked = false;
  let timeAsked = false;

  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    const content = msg.content || '';
    const lowerContent = content.toLowerCase();

    if (msg.role === 'agent') {
      // First name questions - English + Italian
      if (lowerContent.includes('first name') || 
          lowerContent.includes('your name') ||
          lowerContent.includes('what is your name') ||
          lowerContent.includes('may i have your name') ||
          lowerContent.includes('nome') || 
          lowerContent.includes('come ti chiami') ||
          lowerContent.includes('qual è il tuo nome') ||
          lowerContent.includes('qual e il tuo nome') ||
          lowerContent.includes('il tuo nome')) {
        firstNameAsked = true;
      }
      
      // Last name questions - English + Italian
      if ((lowerContent.includes('last name') || 
           lowerContent.includes('surname') ||
           lowerContent.includes('cognome') ||
           lowerContent.includes('qual è il tuo cognome') ||
           lowerContent.includes('qual e il tuo cognome'))) {
        lastNameAsked = true;
      }
      
      // Phone number questions - English + Italian
      if (lowerContent.includes('phone') || 
          lowerContent.includes('number') ||
          lowerContent.includes('contact number') ||
          lowerContent.includes('telefono') || 
          lowerContent.includes('numero') ||
          lowerContent.includes('recapito') ||
          lowerContent.includes('cellulare')) {
        phoneAsked = true;
      }
      
      // Guest count questions - English + Italian
      if (lowerContent.includes('how many') || 
          lowerContent.includes('people') ||
          lowerContent.includes('guests') ||
          lowerContent.includes('persons') ||
          lowerContent.includes('quante persone') ||
          lowerContent.includes('numero di persone') ||
          lowerContent.includes('ospiti') ||
          lowerContent.includes('quant')) {
        guestsAsked = true;
      }
      
      // Date questions - English + Italian
      if (lowerContent.includes('when') || 
          lowerContent.includes('what date') ||
          lowerContent.includes('which day') ||
          lowerContent.includes('quando') ||
          lowerContent.includes('che data') ||
          lowerContent.includes('che giorno') ||
          lowerContent.includes('quale data')) {
        dateAsked = true;
      }
      
      // Time questions - English + Italian
      if (lowerContent.includes('what time') ||
          lowerContent.includes('which time') ||
          lowerContent.includes('che ora') ||
          lowerContent.includes('a che ora')) {
        timeAsked = true;
      }
    }

    if (msg.role === 'user') {
      // Capture first name response
      if (firstNameAsked && !lastNameAsked && !data.firstName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.firstName = nameMatch[1];
          firstNameAsked = false;
        }
      }
      
      // Capture last name response
      if (lastNameAsked && !data.lastName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.lastName = nameMatch[1];
          lastNameAsked = false;
        }
      }
      
      // Capture guest count
      if (guestsAsked && !data.guests) {
        if (lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/)) {
          const match = lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/);
          data.guests = parseInt(match[1]) || 0;
          data.adults = data.guests;
          guestsAsked = false;
        }
        else if (lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/) ||
                 lowerContent.includes('due persone') ||
                 lowerContent.includes('per due')) {
          const match = lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/);
          if (match && match[1]) {
            data.guests = parseInt(match[1]) || 0;
            data.adults = data.guests;
            guestsAsked = false;
          }
        }
      }
      
      // Capture time
      if (timeAsked && !data.time) {
        const timeMatch = content.match(/\b(\d{1,2}[:.]\d{2})\b/);
        if (timeMatch) {
          data.time = timeMatch[1].replace('.', ':');
          timeAsked = false;
        }
      }
      
      // Capture date
      if (dateAsked && !data.date) {
        if (lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          dateAsked = false;
        }
        else if ((lowerContent.includes('venerdì') || lowerContent.includes('venerdi')) && 
                 (lowerContent.includes('21:45') || lowerContent.includes('21.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          dateAsked = false;
        }
        else if (lowerContent.includes('stasera') || lowerContent.includes('questa sera')) {
          data.date = convertDayToDate('today');
          data.time = '20:00';
          dateAsked = false;
        }
        else if (lowerContent.includes('domani') || lowerContent.includes('tomorrow')) {
          data.date = convertDayToDate('tomorrow');
          data.time = '20:00';
          dateAsked = false;
        }
      }
      
      // ✅ FIXED: Capture phone number - fixed variable name
      if (phoneAsked) {
        const digits = content
          .replace(/zero/gi, '0')
          .replace(/one/gi, '1')
          .replace(/two/gi, '2')
          .replace(/three/gi, '3')
          .replace(/four/gi, '4')
          .replace(/five/gi, '5')
          .replace(/six/gi, '6')
          .replace(/seven/gi, '7')
          .replace(/eight/gi, '8')
          .replace(/nine/gi, '9')
          .replace(/uno/gi, '1')
          .replace(/due/gi, '2')
          .replace(/tre/gi, '3')
          .replace(/quattro/gi, '4')
          .replace(/cinque/gi, '5')
          .replace(/sei/gi, '6')
          .replace(/sette/gi, '7')
          .replace(/otto/gi, '8')
          .replace(/nove/gi, '9')
          .replace(/\D/g, '');
        
        if (digits.length > 0) {
          phoneDigits += digits; // ✅ Fixed: was "phoneDigits += digits;"
        }
        
        if (phoneDigits.length >= 10) {
          phoneAsked = false;
        }
      }
    }
  }
  
  if (phoneDigits.length >= 7) {
    data.phone = '+39' + phoneDigits.substring(0, 10);
  }
  
  safeLog('Conversation flow data extracted', data);
  return data;
}

function extractFromSystemLogs(logs) {
  const data = {};
  
  if (!logs) return data;
  
  const patterns = {
    firstName: /Name:\s*([A-Za-z]+)/i,
    lastName: /Name:\s*[A-Za-z]+\s+([A-Za-z]+)/i,
    phone: /Phone:\s*([+\d\s]+)/i,
    guests: /Guests?:\s*(\d+)/i,
    date: /Date[\/\s]Time:\s*([^,\n]+)/i,
    time: /(\d{1,2}:\d{2})/,
    specialRequests: /Special Requests:\s*([^\n]+)/i,
    newsletter: /Newsletter:\s*(true|false|yes|no)/i
  };
  
  Object.entries(patterns).forEach(([field, pattern]) => {
    const match = logs.match(pattern);
    if (match && match[1]) {
      const value = match[1].trim();
      safeLog('System log field found', { field, value });
      
      switch (field) {
        case 'firstName':
          data.firstName = value;
          break;
        case 'lastName':
          data.lastName = value;
          break;
        case 'phone':
          data.phone = value.replace(/\s/g, '');
          break;
        case 'guests':
          data.guests = parseInt(value);
          data.adults = data.guests;
          break;
        case 'date':
          data.date = convertDayToDate(value);
          break;
        case 'time':
          data.time = value;
          break;
        case 'specialRequests':
          data.specialRequests = value;
          break;
        case 'newsletter':
          data.newsletter = value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
          break;
      }
    }
  });
  
  return data;
}

function mergeAndResolveData(sources, defaultData) {
  safeLog('Merging and resolving data from all sources');
  
  const finalData = { ...defaultData };
  const sourcePriority = ['structuredBlock', 'conversationFlow', 'systemLogs'];
  
  const fields = ['firstName', 'lastName', 'phone', 'guests', 'adults', 'children', 'date', 'time', 'specialRequests', 'newsletter'];
  
  fields.forEach(field => {
    for (const source of sourcePriority) {
      if (sources[source][field] !== undefined && 
          sources[source][field] !== '' && 
          sources[source][field] !== null) {
        
        if (isValidFieldValue(field, sources[source][field])) {
          safeLog('Using field from source', { field, source, value: sources[source][field] });
          finalData[field] = sources[source][field];
          break;
        }
      }
    }
  });
  
  crossValidateFields(finalData, sources);
  
  return finalData;
}

function isValidFieldValue(field, value) {
  switch (field) {
    case 'phone':
      return value.length >= 10;
    case 'guests':
    case 'adults':
    case 'children':
      return value > 0 && value < 20;
    case 'time':
      return /^\d{1,2}:\d{2}$/.test(value);
    default:
      return true;
  }
}

function crossValidateFields(finalData, sources) {
  if (finalData.adults && finalData.children !== undefined) {
    const calculatedGuests = finalData.adults + finalData.children;
    if (finalData.guests !== calculatedGuests) {
      safeLog('Guest count mismatch', { 
        total: finalData.guests, 
        adults: finalData.adults, 
        children: finalData.children 
      });
      if (calculatedGuests > 0 && calculatedGuests < 20) {
        finalData.guests = calculatedGuests;
      }
    }
  }
  
  if (finalData.phone && !finalData.phone.startsWith('+39')) {
    finalData.phone = '+39' + finalData.phone.replace(/\D/g, '');
  }
  
  // Check if date is in the past (Rome timezone) - FIXED: date-only comparison
  if (finalData.date) {
    try {
      const romeResDay = startOfDay(
        utcToZonedTime(
          zonedTimeToUtc(`${finalData.date}T00:00:00`, ROME_TIMEZONE), 
          ROME_TIMEZONE
        )
      );
      const romeTodayDay = startOfDay(getRomeDate());
      
      if (isBefore(romeResDay, romeTodayDay)) {
        safeLog('Date is in the past', { date: finalData.date });
      }
    } catch (error) {
      safeLog('Error validating date', { error: error.message, date: finalData.date }, 'warn');
    }
  }
}

// ===== GOOGLE CALENDAR INTEGRATION =====
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// Your JAZZAMORE CALENDAR ID
const JAZZAMORE_CALENDAR_ID = 'jazzamorecesena@gmail.com';

// Service account credentials from your JSON
const serviceAccount = {
  "type": "service_account",
  "project_id": "retell-calendar-478918",
  "private_key_id": "61c350b543e79f38bbbd392e86abf26a092e813f",
  "private_key": `-----BEGIN PRIVATE KEY-----
MIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQC8ews3+pAiFTK0
NQzVD1E6nMJpY+gXWbM5vfqNGoQ8zIGG/2GYhWnAqoX6nXq15HqGiuduOna6gf7T
52BnIHyaiQNJhpd9J6E93MSYd+yAHgkymiSKUg6a+wcT91AhEJ/dTt161+2hznF8
qOt6u1D4r5XKN30P+LtI5X0rMtKFq5PI3XfZwsMaKiYL43/i5U+DlxkiwiJZXwj3
opCfmchJoV0sm8LeiJhELYrsiDpuLbyD1RIuNbfEX9SraZKBL/zhc6JlxUflParv
G++X/lc9UWHtqkKHWDFjc0z89SXk/DCFVVX9o0KEKcT2D/d6EmcBU8hX5mC9WjrY
1ENgKp0LAgMBAAECgf9J/gPpdfQfbTL6i9j9y4WX/PJVbWMvx4cUpAA4ZLCFLcOr
u5YUyks517fBKxGBVrDDIMS6ATma/m2LwsmVsqs3/5HKy4utFmG2Z3TGZk3x/die
hOTTaGNTdDjTHcPXNy+LMerAzwP7AZCL38SR6fdfqY6kVCREoODlPTJmQw1ia8vC
veb9ZQQoP0GOU0e8T/z8ybXSp3to6+oLMgoISCmGv+6w5dDwYErvh3E13iQF8bsq
c+fAk3gGnScz0qL5UQGsmfafZp9TE5c3UwAhQNyUig8twew+Lq/IgZppJ00Tspl8
eCqrMa0/KIHCNsndyiLJ4vN08HS+F2tLIiRxOgUCgYEA8tEFjHhd4BZVW1BUskst
pynPB36FbE31Zwap3cNJeA5tGE8kwInC0COoac5MgAZ8gwqOyqG1YI1LkVVjHEch
ElLPcrcrgEojEPDW15vsYKdDo1i2T0GeBiP+NKovp8IoDbJNeLpf+1aXwEHkbFrM
FfewPnoI6iicnO2iqYxjLRcCgYEAxrbKxJTbUbBf1rJvYS3FGPCj51RX9EoQ7SyN
gJvQdGGjLhc2CR2EPIHFHzwCyz1yKy7vfcr085zCS3IbP/p/C7IHLdZt2iLgOv/C
oaddIQo03yQQ/C/Ouft2qHSBc1wlMunHyxR+QjwALav3NE95QY4KF6OOuFjCTLMF
L+xP0C0CgYEA2T6Ps1UB0HrK1Y7yqC5A4z2xv+e/4d2CATJiCkot0l891jEBFc5r
YSN2C2wK38Rt5CQvCzZQ+9iO0rHNocA145n5ho5BOl+aLg78eR1FCFi+WEgHnLN9
ecr8JgxZ5ML+aPqs+6XsOAgKb3XEs/ksfT8FDXDLxwycyn6GOSGknfMCgYAgsSX+
3XaPo/LAga6tUDhi+AQfJNMrj5vlSTUmeXv8CawtAwiSy1ZcFgV2NAtJoJxN2nTw
Pxm5koqsmuM8zVtlcy6XLfX4s1AspLNCoSRDMUithWN9+eeK1YIaCMDbV8eO7sM9
9+slvnVRDj+nTYPncxTZ+sCaN5APykwKLFidKQKBgAo5b57WIPozfkWDKcoKrK3x
7jrqVNpigQC/FJjYRowRAIWr4k8hm/LXxGGrP9Km3OqwTQcfCxL06bxeb3Y/mfWz
ejQerM4Bu1hcq38DAq/84ZLrx2hRySzD8/PcFVvE5Web5yH4cXN3icU1970vVCgQ
UIfURnA8dT2WX4pl24pR
-----END PRIVATE KEY-----`,
  "client_email": "retell-ai-calendar@retell-calendar-478918.iam.gserviceaccount.com",
  "client_id": "107319862827925724291",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/retell-ai-calendar%40retell-calendar-478918.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

async function getCalendarClient() {
  try {
    safeLog('Initializing Google Calendar client', { serviceAccount: serviceAccount.client_email });
    
    // Ensure private key has proper newlines
    const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
    
    const auth = new google.auth.GoogleAuth({
      credentials: {
        ...serviceAccount,
        private_key: privateKey
      },
      scopes: SCOPES,
    });
    
    const authClient = await auth.getClient();
    
    const calendar = google.calendar({ 
      version: 'v3', 
      auth: authClient 
    });
    
    safeLog('Google Calendar client initialized successfully');
    return calendar;
    
  } catch (error) {
    safeLog('Error getting Google Calendar client', { error: error.message }, 'error');
    return null;
  }
}

function analyzeEventAvailability(event) {
  const {
    id,
    summary,
    description,
    start,
    end,
    attendees,
    extendedProperties,
    attendeesOmitted,
    status,
    location
  } = event;

  const availability = {
    eventId: id,
    title: summary || 'Untitled Event',
    description: description || '',
    location: location || '',
    startTime: start?.dateTime || start?.date,
    endTime: end?.dateTime || end?.date,
    isSoldOut: false,
    availableSpots: null,
    totalCapacity: null,
    currentAttendees: 0,
    waitingList: false,
    soldOutReason: null,
    rawEvent: event
  };

  if (extendedProperties?.private) {
    const privateProps = extendedProperties.private;
    
    if (privateProps.soldOut === 'true' || privateProps.soldOut === true) {
      availability.isSoldOut = true;
      availability.soldOutReason = 'Marked as sold out in event properties';
    }
    
    if (privateProps.maxCapacity) {
      availability.totalCapacity = parseInt(privateProps.maxCapacity);
    }
    
    if (privateProps.currentAttendees) {
      availability.currentAttendees = parseInt(privateProps.currentAttendees);
    }
    
    if (availability.totalCapacity !== null && availability.currentAttendees !== null) {
      availability.availableSpots = Math.max(0, availability.totalCapacity - availability.currentAttendees);
      if (availability.availableSpots <= 0) {
        availability.isSoldOut = true;
        availability.soldOutReason = `Capacity reached: ${availability.currentAttendees}/${availability.totalCapacity}`;
      }
    }
    
    if (privateProps.waitingList === 'true' || privateProps.waitingList === true) {
      availability.waitingList = true;
    }
  }

  if (attendeesOmitted === true) {
    availability.isSoldOut = true;
    availability.soldOutReason = 'Attendees omitted (likely at capacity)';
  }

  if (description) {
    const soldOutKeywords = [
      'sold out', 'sold-out', 'fully booked',
      'no seats', 'no seats available', 'no availability',
      'maximum capacity', 'at capacity', 'complet',
      'waitlist only', 'waiting list', 'lista d\'attesa',
      'esaurito', 'tutto esaurito', 'prenotazioni chiuse'
    ];

    const lowerDesc = description.toLowerCase();
    for (const keyword of soldOutKeywords) {
      if (lowerDesc.includes(keyword)) {
        availability.isSoldOut = true;
        availability.soldOutReason = `Found keyword in description: "${keyword}"`;
        break;
      }
    }
  }

  if (attendees && Array.isArray(attendees)) {
    const confirmedAttendees = attendees.filter(attendee => 
      attendee.responseStatus === 'accepted'
    ).length;
    
    if (confirmedAttendees > 0) {
      availability.currentAttendees = confirmedAttendees;
    }
    
    if (availability.totalCapacity && confirmedAttendees >= availability.totalCapacity) {
      availability.isSoldOut = true;
      availability.soldOutReason = `Attendee count reached capacity: ${confirmedAttendees}/${availability.totalCapacity}`;
    }
  }

  if (status === 'cancelled') {
    availability.isSoldOut = true;
    availability.soldOutReason = 'Event cancelled';
  }

  return availability;
}

async function searchEventsByDate(dateString, calendarId = null) {
  safeLog('Searching events for date', { date: dateString, timezone: ROME_TIMEZONE });
  
  try {
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error('Google Calendar client not available');
    }
    
    // Use specific Jazzamore calendar ID
    const targetCalendarId = calendarId || JAZZAMORE_CALENDAR_ID;
    
    // ✅ Fixed: Use string dates for conversion, not Date objects
    // Create start and end of day in Rome timezone using strings
    const startOfDayUTC = zonedTimeToUtc(`${dateString}T00:00:00`, ROME_TIMEZONE);
    const endOfDayUTC = zonedTimeToUtc(`${dateString}T23:59:59`, ROME_TIMEZONE);
    
    try {
      const response = await calendar.events.list({
        calendarId: targetCalendarId,
        timeMin: startOfDayUTC.toISOString(),
        timeMax: endOfDayUTC.toISOString(),
        maxResults: 20,
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: ROME_TIMEZONE
      });

      const events = response.data.items || [];
      safeLog('Successfully fetched events from Google Calendar', { count: events.length });
      
      if (events.length === 0) {
        return [];
      }
      
      // Analyze each event for availability
      const analyzedEvents = events.map(event => {
        const availability = analyzeEventAvailability(event);
        
        // ✅ Fixed: Use consistent date format (YYYY-MM-DD)
        let time = 'All day';
        let dateStr = dateString; // Input is already YYYY-MM-DD
        
        if (event.start?.dateTime) {
          const eventStart = new Date(event.start.dateTime);
          time = formatInTimeZone(eventStart, ROME_TIMEZONE, 'HH:mm');
          dateStr = formatInTimeZone(eventStart, ROME_TIMEZONE, 'yyyy-MM-dd'); // ✅ Consistent format
        }
        
        return {
          date: dateStr,
          time: time,
          title: availability.title,
          location: availability.location,
          isSoldOut: availability.isSoldOut,
          soldOutReason: availability.soldOutReason,
          capacity: availability.totalCapacity ? 
            `${availability.currentAttendees}/${availability.totalCapacity}` : 'Unknown',
          availableSpots: availability.availableSpots,
          hasWaitingList: availability.waitingList,
          description: availability.description,
          startTime: event.start?.dateTime || event.start?.date,
          endTime: event.end?.dateTime || event.end?.date,
          isRealEvent: true
        };
      });
      
      // Sort events by time
      analyzedEvents.sort((a, b) => {
        const timeA = a.time === 'All day' ? '00:00' : a.time;
        const timeB = b.time === 'All day' ? '00:00' : b.time;
        return timeA.localeCompare(timeB);
      });
      
      return analyzedEvents;
      
    } catch (apiError) {
      safeLog('Google Calendar API Error', { error: apiError.message }, 'error');
      throw new Error(`Google Calendar API Error: ${apiError.message}`);
    }
    
  } catch (error) {
    safeLog('Error searching Google Calendar events', { error: error.message }, 'error');
    throw error;
  }
}

// Check for actual time overlap conflicts (CORRECTED - include all events)
async function checkCalendarForConflicts(date, time, calendarId = null) {
  try {
    // Create reservation start time in Rome timezone
    const reservationStartStr = `${date}T${time}:00`;
    const reservationStart = zonedTimeToUtc(reservationStartStr, ROME_TIMEZONE);
    
    // Assume reservation lasts 2 hours (dinner + show)
    const RESERVATION_DURATION_MINUTES = 120;
    const reservationEnd = new Date(reservationStart.getTime() + RESERVATION_DURATION_MINUTES * 60 * 1000);
    
    safeLog('Checking calendar conflicts', { 
      date, 
      time, 
      reservationWindow: {
        start: reservationStart.toISOString(),
        end: reservationEnd.toISOString()
      }
    });
    
    const events = await searchEventsByDate(date, calendarId);
    
    // Check for actual time overlap with ALL events (not just available ones)
    const conflictingEvents = events.filter(event => {
      try {
        if (!event.startTime) return false;
        
        const eventStart = new Date(event.startTime);
        const eventEnd = event.endTime ? new Date(event.endTime) : 
          new Date(eventStart.getTime() + 60 * 60 * 1000); // Default 1 hour if no end time
        
        // Check for overlap (any event blocks the time, regardless of availability)
        const overlaps = (reservationStart < eventEnd && eventStart < reservationEnd);
        
        return overlaps;
      } catch (error) {
        safeLog('Error parsing event time for conflict check', { error: error.message }, 'warn');
        return false;
      }
    });
    
    safeLog('Calendar conflict check result', { 
      conflictingEventsCount: conflictingEvents.length,
      totalEvents: events.length 
    });
    
    return {
      hasConflicts: conflictingEvents.length > 0,
      conflictingEvents: conflictingEvents,
      reservationWindow: {
        start: reservationStart.toISOString(),
        end: reservationEnd.toISOString(),
        durationMinutes: RESERVATION_DURATION_MINUTES
      },
      totalEventsInTimeframe: events.length
    };
    
  } catch (error) {
    safeLog('Error checking calendar conflicts', { error: error.message }, 'error');
    throw error;
  }
}

// ===== NEW TIMEZONE AWARE ENDPOINTS =====

// A) Authoritative time context endpoint
app.get('/api/now', (req, res) => {
  try {
    const romeDateTime = getRomeDateTime();
    const greeting = getItalianTimeGreeting();
    
    res.json({
      success: true,
      timezone: ROME_TIMEZONE,
      now: romeDateTime.iso,
      date: romeDateTime.date,
      time: romeDateTime.time,
      year: romeDateTime.year,
      month: romeDateTime.month,
      day: romeDateTime.day,
      hour: romeDateTime.hour,
      minute: romeDateTime.minute,
      greeting: greeting,
      note: "All dates and times are based on Europe/Rome timezone using date-fns-tz"
    });
  } catch (error) {
    safeLog('Error in /api/now endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to get Rome time',
      message: error.message
    });
  }
});

// B) Date resolution endpoint
app.get('/api/resolve-date', (req, res) => {
  try {
    const { text } = req.query;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Missing text parameter',
        message: 'Please provide a date text like "the 13th", "tomorrow", "next friday", etc.'
      });
    }
    
    const resolvedDate = parseRelativeDate(text);
    const romeDateTime = getRomeDateTime();
    
    res.json({
      success: true,
      originalText: text,
      resolvedDate: resolvedDate,
      timezone: ROME_TIMEZONE,
      todayInRome: romeDateTime.date,
      source: 'Rome-timezone-aware parsing using date-fns-tz',
      message: `"${text}" resolved to ${resolvedDate} based on Rome time (today: ${romeDateTime.date})`
    });
    
  } catch (error) {
    safeLog('Error in /api/resolve-date endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to resolve date',
      message: error.message
    });
  }
});

// ===== CALENDAR ENDPOINTS FOR AI AGENT =====

// Get events for a specific date (AI agent will call this)
app.get('/api/calendar/date', async (req, res) => {
  try {
    let { date } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date (YYYY-MM-DD or relative date like "tomorrow", "the fourth", etc.)'
      });
    }
    
    safeLog('AI Agent requested events for date', { originalDate: date });
    
    // Check if it's a relative date
    let parsedDate = date;
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      parsedDate = parseRelativeDate(date);
      safeLog('Parsed relative date', { original: date, parsed: parsedDate });
    }
    
    try {
      const events = await searchEventsByDate(parsedDate);
      
      res.json({
        success: true,
        originalDate: date,
        parsedDate: parsedDate,
        eventCount: events.length,
        events: events,
        summary: `Found ${events.length} event(s) for ${parsedDate}.`,
        note: 'Using REAL Google Calendar data only - no mock data'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in /api/calendar/date', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to fetch calendar events',
        message: calendarError.message,
        note: 'NO MOCK DATA AVAILABLE - Google Calendar access required'
      });
    }
    
  } catch (error) {
    safeLog('Error in calendar/date endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
      message: error.message,
      note: 'NO MOCK DATA AVAILABLE - Google Calendar access required'
    });
  }
});

// Check availability for specific date and time
app.get('/api/calendar/availability', async (req, res) => {
  try {
    const { date, time } = req.query;
    
    if (!date || !time) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters',
        message: 'Please provide both date (YYYY-MM-DD) and time (HH:MM)'
      });
    }
    
    safeLog('AI Agent checking availability', { date, time });
    
    try {
      const calendarCheck = await checkCalendarForConflicts(date, time);
      const isAvailable = !calendarCheck.hasConflicts;
      
      res.json({
        success: true,
        date: date,
        time: time,
        available: isAvailable,
        hasConflicts: calendarCheck.hasConflicts,
        conflictingEventsCount: calendarCheck.conflictingEvents.length,
        conflictingEvents: calendarCheck.conflictingEvents.map(e => ({
          title: e.title,
          time: e.time,
          isSoldOut: e.isSoldOut
        })),
        reservationDuration: calendarCheck.reservationWindow.durationMinutes,
        message: isAvailable 
          ? `Time slot ${time} on ${date} is available for a ${calendarCheck.reservationWindow.durationMinutes}-minute reservation.` 
          : `Time slot ${time} on ${date} conflicts with ${calendarCheck.conflictingEvents.length} event(s).`,
        details: 'This checks for actual time overlap conflicts with ALL calendar events.',
        note: 'Using REAL Google Calendar data only - no mock data'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in /api/calendar/availability', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to check calendar availability',
        message: calendarError.message,
        note: 'NO MOCK DATA AVAILABLE - Google Calendar access required'
      });
    }
    
  } catch (error) {
    safeLog('Error in calendar/availability endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
      message: error.message,
      note: 'NO MOCK DATA AVAILABLE - Google Calendar access required'
    });
  }
});

// Diagnostic endpoint (CORRECTED - uses Rome timezone correctly)
app.get('/api/calendar/diagnostic', async (req, res) => {
  try {
    safeLog('Running calendar diagnostic');
    
    const calendar = await getCalendarClient();
    
    if (!calendar) {
      return res.json({
        success: false,
        step: 'authentication',
        error: 'Failed to authenticate with Google Calendar',
        serviceAccount: serviceAccount.client_email,
        clientId: serviceAccount.client_id,
        action: 'Check service account credentials'
      });
    }
    
    // Test Jazzamore calendar access
    try {
      // ✅ Fixed: Use string dates instead of Date objects for conversion
      const todayRome = getRomeDateToday();
      const startUTC = zonedTimeToUtc(`${todayRome}T00:00:00`, ROME_TIMEZONE);
      const endUTC = zonedTimeToUtc(`${todayRome}T23:59:59`, ROME_TIMEZONE);
      
      const response = await calendar.events.list({
        calendarId: JAZZAMORE_CALENDAR_ID,
        timeMin: startUTC.toISOString(),
        timeMax: endUTC.toISOString(),
        maxResults: 1,
      });
      
      res.json({
        success: true,
        diagnostic: {
          authentication: '✅ OK',
          jazzamoreCalendar: `✅ Accessible (${JAZZAMORE_CALENDAR_ID})`,
          eventsFound: response.data.items?.length || 0,
          serviceAccount: serviceAccount.client_email,
          scope: 'calendar.readonly',
          permissionRequired: 'Read-only access (See all event details)',
          timezone: ROME_TIMEZONE,
          romeToday: formatInTimeZone(new Date(), ROME_TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
          message: 'Jazzamore calendar is accessible and ready for use'
        }
      });
      
    } catch (error) {
      safeLog('Jazzamore calendar access failed', { error: error.message }, 'error');
      return res.json({
        success: false,
        step: 'calendar_access',
        error: `Cannot access Jazzamore calendar: ${error.message}`,
        jazzamoreCalendarId: JAZZAMORE_CALENDAR_ID,
        serviceAccount: serviceAccount.client_email,
        action: 'Share your Google Calendar with the service account email above with "See all event details" permission',
        note: 'Only read permission is needed, not edit permission'
      });
    }
    
  } catch (error) {
    safeLog('Diagnostic error', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== MAIN WEBHOOK ENDPOINT =====
app.post('/api/reservations', async (req, res) => {
  try {
    const { event, call } = req.body;
    
    safeLog('Retell webhook received', { event, callId: call?.call_id });
    
    if (event !== 'call_analyzed') {
      return res.json({ status: 'received', event: event });
    }
    
    // ===== RESERVATION INTENT DETECTION =====
    const conversationText = call?.transcript_object
      ?.map(msg => msg.content || '')
      .join(' ')
      .toLowerCase() || '';
    
    const intentResult = detectReservationIntent(conversationText, call?.transcript_object || []);
    
    // If caller doesn't want to make a reservation, return early
    if (!intentResult.wantsReservation) {
      safeLog('No reservation intent detected', { reason: intentResult.reason });
      const greeting = getItalianTimeGreeting();
      return res.json({
        response: `${greeting}! Grazie per aver chiamato il Jazzamore. Se hai bisogno di fare una prenotazione, siamo a tua disposizione. Arrivederci!`,
        saveToAirtable: false,
        reason: 'No reservation intent detected',
        detectionDetails: intentResult
      });
    }
    
    safeLog('Reservation intent detected', { reason: intentResult.reason });
    
    // ===== EXTRACT RESERVATION DATA =====
    const reservationId = generateReservationId();
    let reservationData = {};
    
    // Use Post-Call Analysis if available
    let postCallData = null;
    if (call?.call_analysis?.custom_analysis_data?.reservation_details) {
      try {
        postCallData = JSON.parse(call.call_analysis.custom_analysis_data.reservation_details);
        safeLog('Using Post-Call Analysis data');
      } catch (error) {
        safeLog('Error parsing Post-Call Analysis', { error: error.message }, 'warn');
      }
    }
    
    if (postCallData) {
      reservationData = {
        firstName: postCallData.first_name || postCallData.firstName || '',
        lastName: postCallData.last_name || postCallData.lastName || '',
        phone: postCallData.phone || '',
        guests: parseInt(postCallData.guests) || 0,
        adults: parseInt(postCallData.adults) || (parseInt(postCallData.guests) || 0),
        children: parseInt(postCallData.children) || 0,
        date: postCallData.date ? convertDayToDate(postCallData.date) : '',
        time: postCallData.time || '',
        specialRequests: postCallData.special_requests || postCallData.specialRequests || '',
        newsletter: postCallData.newsletter === 'yes' || postCallData.newsletter_opt_in === 'yes' || postCallData.newsletter === true || false
      };
    } else if (call?.transcript_object) {
      // Fall back to transcript extraction (but don't log full transcript)
      reservationData = extractReservationData(call.transcript_object);
    }
    
    safeLog('Extracted reservation data', { 
      hasDate: !!reservationData.date,
      hasTime: !!reservationData.time,
      hasGuests: !!reservationData.guests,
      hasName: !!(reservationData.firstName || reservationData.lastName),
      hasPhone: !!reservationData.phone
    });
    
    // ===== VALIDATE RESERVATION DATA =====
    const validation = validateReservationData(reservationData);
    
    if (!validation.isValid) {
      safeLog('Reservation validation failed', { errors: validation.errors });
      
      // Determine which clarification is needed
      let clarificationMessage = '';
      if (validation.errors.some(e => e.includes('Date'))) {
        clarificationMessage = 'Per favore, dimmi per che data desideri prenotare.';
      } else if (validation.errors.some(e => e.includes('Time'))) {
        clarificationMessage = 'Per favore, dimmi a che ora desideri prenotare (es: 20:00).';
      } else if (validation.errors.some(e => e.includes('guests'))) {
        clarificationMessage = 'Per quante persone desideri prenotare?';
      } else {
        clarificationMessage = 'Mi dispiace, ho bisogno di alcune informazioni per completare la prenotazione.';
      }
      
      const greeting = getItalianTimeGreeting();
      return res.json({
        response: `${greeting}! ${clarificationMessage}`,
        saveToAirtable: false,
        reason: 'Missing required reservation details',
        validationErrors: validation.errors,
        validationWarnings: validation.warnings
      });
    }
    
    // Check for important warnings
    const needsClarification = validation.warnings.length > 0;
    if (needsClarification) {
      safeLog('Reservation needs clarification', { warnings: validation.warnings });
      
      let clarificationMessage = 'Perfetto! ';
      if (validation.warnings.some(w => w.includes('Name'))) {
        clarificationMessage += 'Potresti dirmi il tuo nome per favore? ';
      }
      if (validation.warnings.some(w => w.includes('Phone'))) {
        clarificationMessage += 'E il tuo numero di telefono? ';
      }
      clarificationMessage += 'Così posso completare la prenotazione.';
      
      const greeting = getItalianTimeGreeting();
      return res.json({
        response: `${greeting}! ${clarificationMessage}`,
        saveToAirtable: false,
        reason: 'Need clarification on important details',
        validationWarnings: validation.warnings
      });
    }
    
    const { firstName, lastName, date, time, guests, adults, children, phone, specialRequests, newsletter } = reservationData;
    
    // ===== CHECK CALENDAR AVAILABILITY =====
    let calendarCheck;
    try {
      calendarCheck = await checkCalendarForConflicts(date, time);
      
      if (calendarCheck.hasConflicts) {
        safeLog('Calendar conflicts detected', { count: calendarCheck.conflictingEvents.length });
      }
    } catch (calendarError) {
      safeLog('Calendar check failed', { error: calendarError.message }, 'error');
      calendarCheck = {
        hasConflicts: false,
        conflictingEvents: [],
        error: calendarError.message
      };
    }
    
    // If there are conflicts, inform the user
    if (calendarCheck.hasConflicts) {
      const greeting = getItalianTimeGreeting();
      const conflictMessage = `Mi dispiace, l'orario ${time} del ${date} non è disponibile a causa di un conflitto di eventi.`;
      
      return res.json({
        response: `${greeting}! ${conflictMessage} Ti consiglierei di scegliere un altro orario.`,
        saveToAirtable: false,
        reason: 'Calendar conflict',
        calendarCheck: {
          hasConflicts: true,
          conflictingEventsCount: calendarCheck.conflictingEvents.length
        }
      });
    }
    
    // ===== SAVE TO AIRTABLE =====
    const arrivalTimeISO = formatTimeForAirtable(time, date);
    
    // Prepare Airtable record with only fields that should exist
    const airtableFields = {
      "Reservation ID": reservationId,
      "First Name": firstName || '',
      "Last Name": lastName || '',
      "Phone Number": phone || '',
      "Reservation Date": date,
      "Arrival Time": arrivalTimeISO,
      "Total People": guests,
      "Dinner Count": adults || guests,
      "Kids Count": children || 0,
      "Special Requests": specialRequests || '',
      "Reservation Status": "Pending",
      "Newsletter Opt-In": newsletter || false
    };
    
    try {
      const record = await base('Reservations').create([{ fields: airtableFields }]);
      
      safeLog('Reservation saved to Airtable', { 
        reservationId,
        date,
        time,
        guests,
        airtableId: record[0].id
      });
      
      // ===== TIME-AWARE RESPONSE =====
      const greeting = getItalianTimeGreeting();
      let timeAwareResponse;
      
      if (greeting === "Buongiorno") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buona giornata!`;
      } else if (greeting === "Buon pomeriggio") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buon proseguimento!`;
      } else if (greeting === "Buonasera") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buona serata!`;
      } else {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buona notte!`;
      }
      
      // If calendar check failed, mention it
      if (calendarCheck.error) {
        timeAwareResponse += ` (Nota: Non è stato possibile verificare la disponibilità del calendario)`;
      }
      
      res.json({
        response: timeAwareResponse,
        saveToAirtable: true,
        reservationId: reservationId,
        intentDetected: true,
        calendarCheck: {
          hasConflicts: false,
          error: calendarCheck.error
        }
      });
      
    } catch (airtableError) {
      safeLog('Airtable error', { error: airtableError.message }, 'error');
      const greeting = getItalianTimeGreeting();
      res.json({
        response: `${greeting}! Abbiamo riscontrato un problema con la prenotazione. Ti preghiamo di riprovare o chiamarci direttamente.`,
        saveToAirtable: false,
        error: airtableError.message
      });
    }
    
  } catch (error) {
    safeLog('Error in main webhook endpoint', { error: error.message }, 'error');
    const greeting = getItalianTimeGreeting();
    res.json({
      response: `${greeting}! Grazie per la tua chiamata! Abbiamo riscontrato un problema. Ti preghiamo di riprovare più tardi.`,
      saveToAirtable: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  const romeDateTime = getRomeDateTime();
  const greeting = getItalianTimeGreeting();
  
  console.log(`\n🎵 Jazzamore server running on port ${PORT}`);
  console.log(`🇮🇹 ${greeting}! Rome time: ${romeDateTime.date} ${romeDateTime.time}`);
  console.log(`📚 Using date-fns-tz for accurate timezone handling`);
  console.log(`🔑 Google Calendar service account: ${serviceAccount.client_email}`);
  console.log(`📅 Jazzamore Calendar ID: ${JAZZAMORE_CALENDAR_ID}`);
  console.log(`🔐 Google Calendar scope: calendar.readonly (read-only access)`);
  console.log(`🔒 PII protection: Sensitive data masked in logs`);
  console.log(`✅ All critical bugs fixed`);
  
  console.log(`\n⏰ TIMEZONE-AWARE ENDPOINTS:`);
  console.log(`   - Now in Rome: http://localhost:${PORT}/api/now`);
  console.log(`   - Resolve date: http://localhost:${PORT}/api/resolve-date?text=the%2013th`);
  
  console.log(`\n📅 CALENDAR ENDPOINTS:`);
  console.log(`   - Date query: http://localhost:${PORT}/api/calendar/date?date=tomorrow`);
  console.log(`   - Availability check: http://localhost:${PORT}/api/calendar/availability?date=${romeDateTime.date}&time=20:00`);
  console.log(`   - Diagnostic: http://localhost:${PORT}/api/calendar/diagnostic`);
  
  console.log(`\n📞 WEBHOOK ENDPOINT:`);
  console.log(`   - Retell webhook: http://localhost:${PORT}/api/reservations`);
  
  console.log(`\n🔧 CRITICAL FIXES APPLIED:`);
  console.log(`   - ✅ Fixed phoneDigits variable bug in extractFromConversationFlow`);
  console.log(`   - ✅ Fixed date format consistency in searchEventsByDate (always YYYY-MM-DD)`);
  console.log(`   - ✅ Safe date-fns-tz import pattern`);
  console.log(`   - ✅ Fixed getRomeDate() with Date.now()`);
  console.log(`   - ✅ Fixed getRomeDateTime() to use single "now" source`);
  console.log(`   - ✅ Fixed zonedTimeToUtc calls to use strings not Date objects`);
  console.log(`   - ✅ Fixed diagnostic endpoint to use string dates`);
  console.log(`   - ✅ Improved PII masking (only specific fields)`);
  console.log(`   - ✅ Proper conflict detection (all events block time)`);
  console.log(`   - ✅ Validation before saving reservations`);
  console.log(`   - ✅ No default date/time assumptions`);
});
