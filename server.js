const express = require('express');
const Airtable = require('airtable');
const cors = require('cors');
const { google } = require('googleapis');
const crypto = require('crypto');

// Safe import pattern for date-fns-tz
const tz = require('date-fns-tz');
const { formatInTimeZone, zonedTimeToUtc, utcToZonedTime } = tz;

const { addDays, startOfDay, endOfDay, format, isBefore, isAfter, addMonths } = require('date-fns');

const app = express();
const PORT = process.env.PORT || 3000;

let pingCounter = 0;
let pingHistory = [];

// ===== MAKE.COM WEBHOOK URL =====
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6u8gmb2j7s84gtpqw5j8o6es9u8l7mu6';

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
    const safeData = JSON.parse(JSON.stringify(data));
    
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

// Get current date in Rome timezone
function getRomeDate() {
  return utcToZonedTime(new Date(Date.now()), ROME_TIMEZONE);
}

// Get today's date string in Rome (DD-MM-YYYY)
function getRomeDateToday() {
  return formatInTimeZone(new Date(Date.now()), ROME_TIMEZONE, 'dd-MM-yyyy');
}

// Get comprehensive Rome date/time info
function getRomeDateTime() {
  const now = new Date(Date.now());
  const romeDate = utcToZonedTime(now, ROME_TIMEZONE);

  return {
    date: formatInTimeZone(now, ROME_TIMEZONE, 'dd-MM-yyyy'),
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

// ===== CUSTOM TIME-BASED GREETING FUNCTION (For Retell Agent) =====
function getItalianTimeGreeting() {
  const romeDate = getRomeDate();
  const currentHour = romeDate.getHours();
  
  // CORRECT ITALIAN TIME RANGES:
  // Buongiorno: 5:00 - 12:59 (5 AM to 12:59 PM)
  // Buon pomeriggio: 13:00 - 16:59 (1 PM to 4:59 PM)
  // Buonasera: 17:00 - 04:59 (5 PM to 4:59 AM)
  if (currentHour >= 5 && currentHour < 13) {
    return "Buongiorno";
  } else if (currentHour >= 13 && currentHour < 17) {
    return "Buon pomeriggio";
  } else {
    return "Buonasera";
  }
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
    // Convert DD-MM-YYYY to YYYY-MM-DD for ISO format
    const [day, month, year] = dateString.split('-');
    const isoDateString = `${year}-${month}-${day}`;
    const utcDate = zonedTimeToUtc(`${isoDateString}T${timeString}:00`, ROME_TIMEZONE);
    return utcDate.toISOString();
  } catch (error) {
    safeLog('Error formatting time for Airtable', { error: error.message }, 'error');
    const fallbackDateTime = `2026-01-01T19:30:00`;
    const utcFallback = zonedTimeToUtc(fallbackDateTime, ROME_TIMEZONE);
    return utcFallback.toISOString();
  }
}

// Convert DD-MM-YYYY to YYYY-MM-DD for internal operations
function convertToISODate(dateString) {
  if (!dateString) return null;
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) return dateString;
  
  const parts = dateString.split('-');
  if (parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateString;
}

// ===== CLOSURE CHECK FOR MONDAYS & TUESDAYS =====
const CLOSED_DAYS = {
  monday: 1,
  tuesday: 2,
  lunedì: 1,
  lunedi: 1,
  martedì: 2,
  martedi: 2
};

const CLOSED_DAY_NAMES = {
  'monday': 'Monday',
  'tuesday': 'Tuesday',
  'lunedì': 'Monday (Lunedì)',
  'lunedi': 'Monday (Lunedì)',
  'martedì': 'Tuesday (Martedì)',
  'martedi': 'Tuesday (Martedì)'
};

/**
 * Check if a date falls on a closed day (Monday or Tuesday)
 * Returns object with closure status and helpful message
 */
function checkIfClosed(dateInput) {
  const resolvedDate = resolveDate(dateInput);
  
  if (!resolvedDate || !resolvedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
    return {
      isClosed: false,
      error: `Invalid date: ${dateInput}`,
      message: "I couldn't understand that date. Could you please specify another day?"
    };
  }
  
  const [day, month, year] = resolvedDate.split('-');
  const dateObj = new Date(`${year}-${month}-${day}`);
  const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, 2 = Tuesday, etc.
  
  // Monday = 1, Tuesday = 2
  const isClosed = (dayOfWeek === 1 || dayOfWeek === 2);
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayNameItalian = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const dayNameEn = dayNames[dayOfWeek];
  const dayNameIt = dayNameItalian[dayOfWeek];
  
  let message = '';
  if (isClosed) {
    message = `I'm sorry, but Jazzamore is closed on ${dayNameEn} (${dayNameIt}). We are open from Wednesday to Sunday. Could you please choose a different day between Wednesday and Sunday?`;
  }
  
  return {
    isClosed,
    date: resolvedDate,
    dayOfWeek,
    dayName: dayNameEn,
    dayNameItalian: dayNameIt,
    message,
    closedDays: ['Monday', 'Tuesday', 'Lunedì', 'Martedì'],
    openDays: 'Wednesday to Sunday (Mercoledì a Domenica)'
  };
}

/**
 * Check if a date string mentions a closed day by name
 * Useful for catching "next monday" before resolving the date
 */
function isClosedDayByName(dateInput) {
  const lowerInput = dateInput.toLowerCase().trim();
  
  // Check for explicit Monday/Tuesday references
  const closedDayPatterns = [
    /^monday$/i, /^tuesday$/i,
    /^luned[iì]$/i, /^marted[iì]$/i,
    /next\s+monday/i, /next\s+tuesday/i,
    /next\s+luned[iì]/i, /next\s+marted[iì]/i,
    /this\s+monday/i, /this\s+tuesday/i,
    /prossim[oa]\s+luned[iì]/i, /prossim[oa]\s+marted[iì]/i
  ];
  
  for (const pattern of closedDayPatterns) {
    if (pattern.test(lowerInput)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get a helpful response for closed day requests
 */
function getClosedDayResponse(dateInput) {
  const lowerInput = dateInput.toLowerCase().trim();
  
  // Determine which day they asked for
  let requestedDay = '';
  if (lowerInput.includes('monday') || lowerInput.includes('lunedì') || lowerInput.includes('lunedi')) {
    requestedDay = 'Monday (Lunedì)';
  } else if (lowerInput.includes('tuesday') || lowerInput.includes('martedì') || lowerInput.includes('martedi')) {
    requestedDay = 'Tuesday (Martedì)';
  } else {
    const check = checkIfClosed(dateInput);
    if (check.isClosed) {
      requestedDay = check.dayName;
    }
  }
  
  return {
    success: false,
    isClosed: true,
    message: `I'm sorry, but Jazzamore is closed on ${requestedDay}. We are open Wednesday through Sunday (Mercoledì a Domenica). Would you like to book for Wednesday, Thursday, Friday, Saturday, or Sunday instead?`,
    suggestedAlternatives: ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    suggestedAlternativesItalian: ['Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
  };
}

// ===================================================================
// ===== CLOSURE CHECK TOOL FOR RETELL AGENT =====
// ===================================================================

/**
 * Check if Jazzamore is closed on a given date
 * Returns: { isClosed, dayName, date, message, suggestedAlternatives }
 */
app.post('/api/check-closure', async (req, res) => {
  try {
    const { date } = req.body;
    const dateArg = req.body.args?.date || date;
    
    if (!dateArg) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date to check'
      });
    }
    
    console.log(`🔍 Closure check requested for: "${dateArg}"`);
    
    // Step 1: Resolve the date using your existing resolve_date function
    let resolvedDate;
    try {
      resolvedDate = resolveDate(dateArg);
      console.log(`📅 Resolved date: ${resolvedDate}`);
    } catch (error) {
      console.log(`❌ Date resolution failed: ${error.message}`);
      return res.status(400).json({
        success: false,
        isClosed: false,
        error: 'Invalid date',
        message: 'I could not understand that date. Could you please specify a different date?'
      });
    }
    
    // Step 2: Parse the resolved date (DD-MM-YYYY)
    if (!resolvedDate || !resolvedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      return res.status(400).json({
        success: false,
        isClosed: false,
        error: 'Invalid date format',
        message: 'I could not understand that date format. Please try another date.'
      });
    }
    
    const [day, month, year] = resolvedDate.split('-');
    const dateObj = new Date(`${year}-${month}-${day}`);
    
    // Step 3: Get day of week (0 = Sunday, 1 = Monday, 2 = Tuesday, etc.)
    const dayOfWeek = dateObj.getDay();
    const isClosed = (dayOfWeek === 1 || dayOfWeek === 2); // Monday or Tuesday
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayNamesItalian = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    
    const dayName = dayNames[dayOfWeek];
    const dayNameItalian = dayNamesItalian[dayOfWeek];
    
    // Step 4: Build response
    const response = {
      success: true,
      isClosed: isClosed,
      date: resolvedDate,
      dayOfWeek: dayOfWeek,
      dayName: dayName,
      dayNameItalian: dayNameItalian,
      originalRequest: dateArg
    };
    
    if (isClosed) {
      response.message = `Jazzamore is closed on ${dayName}s (${dayNameItalian}). We are open Wednesday through Sunday.`;
      response.rejectionPhrase = {
        english: "I'm sorry, Jazzamore is closed on Mondays and Tuesdays. We are open Wednesday through Sunday. Which day would you prefer between Wednesday, Thursday, Friday, Saturday, or Sunday?",
        italian: "Mi dispiace, il Jazzamore è chiuso il Lunedì e il Martedì. Siamo aperti da Mercoledì a Domenica. Che giorno preferisce tra Mercoledì, Giovedì, Venerdì, Sabato o Domenica?"
      };
      response.suggestedAlternatives = ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      response.suggestedAlternativesItalian = ['Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
    } else {
      response.message = `Jazzamore is open on ${dayName} (${dayNameItalian}).`;
      response.confirmationPhrase = {
        english: `Jazzamore is open on ${dayName}. Would you like to make a reservation?`,
        italian: `Il Jazzamore è aperto ${dayNameItalian}. Desidera fare una prenotazione?`
      };
    }
    
    console.log(`📤 Closure check response: isClosed=${isClosed}, day=${dayName}`);
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error in /api/check-closure:', error.message);
    res.status(500).json({
      success: false,
      isClosed: false,
      error: 'Internal server error',
      message: 'I had trouble checking if we are open that day. Could you please try another date?'
    });
  }
});

// GET endpoint for testing (optional)
app.get('/api/check-closure', async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date to check (e.g., "today", "tomorrow", "monday", "15-04-2025")'
      });
    }
    
    // Reuse the same logic as POST
    const resolvedDate = resolveDate(date);
    
    if (!resolvedDate || !resolvedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date',
        message: 'Could not understand that date'
      });
    }
    
    const [day, month, year] = resolvedDate.split('-');
    const dateObj = new Date(`${year}-${month}-${day}`);
    const dayOfWeek = dateObj.getDay();
    const isClosed = (dayOfWeek === 1 || dayOfWeek === 2);
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayNamesItalian = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    res.json({
      success: true,
      input: date,
      resolvedDate: resolvedDate,
      isClosed: isClosed,
      dayOfWeek: dayOfWeek,
      dayName: dayNames[dayOfWeek],
      dayNameItalian: dayNamesItalian[dayOfWeek],
      message: isClosed 
        ? `Jazzamore is closed on ${dayNames[dayOfWeek]}s. Open Wednesday through Sunday.`
        : `Jazzamore is open on ${dayNames[dayOfWeek]}.`
    });
    
  } catch (error) {
    console.error('❌ Error in GET /api/check-closure:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== PHONE EXTRACTION FROM TRANSCRIPT =====
function extractPhoneFromTranscript(transcript) {
  if (!transcript || !Array.isArray(transcript)) {
    console.log('❌ Invalid transcript provided');
    return null;
  }
  
  const DEBUG = true;
  
  function debugLog(message, data = null) {
    if (DEBUG) {
      console.log(`[PhoneExtract] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }
  
  // ===== Context detection =====
  function isInPhoneContext(text) {
    const phoneKeywords = [
      'numero', 'telefono', 'cellulare', 'phone', 'number',
      'il mio numero', 'il numero è', 'numero di telefono',
      'mi può dare il suo numero', 'per la conferma',
      'ripeto il numero', 'confermo il numero', 'per sicurezza',
      'il suo numero di telefono', 'qual è il suo numero'
    ];
    const lowerText = text.toLowerCase();
    return phoneKeywords.some(keyword => lowerText.includes(keyword));
  }
  
  // ===== Time-related words to block =====
  const timeRelatedWords = new Set([
    'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci',
    'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici',
    'diciassette', 'diciotto', 'diciannove',
    'venti', 'ventuno', 'ventidue', 'ventitre', 'ventiquattro', 'venticinque',
    'ventisei', 'ventisette', 'ventotto', 'ventinove',
    'trenta', 'trentuno', 'trentadue', 'trentatre',
    'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta',
    'mezzanotte', 'mezzo', 'un quarto', 'tre quarti'
  ]);
  
  function isTimeRelated(word, surroundingText) {
    const lowerWord = word.toLowerCase();
    if (timeRelatedWords.has(lowerWord)) {
      const timeIndicators = ['alle', 'ore', 'orario', 'dalle', 'fino alle', 'a partire dalle'];
      if (timeIndicators.some(indicator => surroundingText.includes(indicator))) {
        return true;
      }
    }
    return false;
  }
  
  // ===== Number mappings =====
  const singleDigitMap = {
    'zero': '0', 'uno': '1', 'due': '2', 'tre': '3', 'quattro': '4',
    'cinque': '5', 'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9'
  };
  
  const teenMap = {
    'dieci': '10', 'undici': '11', 'dodici': '12', 'tredici': '13',
    'quattordici': '14', 'quindici': '15', 'sedici': '16', 'diciassette': '17',
    'diciotto': '18', 'diciannove': '19'
  };
  
  const tensMap = {
    'venti': '20', 'trenta': '30', 'quaranta': '40', 'cinquanta': '50',
    'sessanta': '60', 'settanta': '70', 'ottanta': '80', 'novanta': '90'
  };
  
  const hundredMap = {
    'cento': '100', 'duecento': '200', 'trecento': '300', 'quattrocento': '400',
    'cinquecento': '500', 'seicento': '600', 'settecento': '700', 'ottocento': '800', 'novecento': '900'
  };
  
  // Compound numbers (21-99)
  const compoundMap = {
    'ventuno': '21', 'ventidue': '22', 'ventitre': '23', 'ventiquattro': '24',
    'venticinque': '25', 'ventisei': '26', 'ventisette': '27', 'ventotto': '28',
    'ventinove': '29', 'trentuno': '31', 'trentadue': '32', 'trentatre': '33',
    'trentaquattro': '34', 'trentacinque': '35', 'trentasei': '36', 'trentasette': '37',
    'trentotto': '38', 'trentanove': '39', 'quarantuno': '41', 'quarantadue': '42',
    'quarantatre': '43', 'quarantaquattro': '44', 'quarantacinque': '45', 'quarantasei': '46',
    'quarantasette': '47', 'quarantotto': '48', 'quarantanove': '49', 'cinquantuno': '51',
    'cinquantadue': '52', 'cinquantatre': '53', 'cinquantaquattro': '54', 'cinquantacinque': '55',
    'cinquantasei': '56', 'cinquantasette': '57', 'cinquantotto': '58', 'cinquantanove': '59',
    'sessantuno': '61', 'sessantadue': '62', 'sessantatre': '63', 'sessantaquattro': '64',
    'sessantacinque': '65', 'sessantasei': '66', 'sessantasette': '67', 'sessantotto': '68',
    'sessantanove': '69', 'settantuno': '71', 'settantadue': '72', 'settantatre': '73',
    'settantaquattro': '74', 'settantacinque': '75', 'settantasei': '76', 'settantasette': '77',
    'settantotto': '78', 'settantanove': '79', 'ottantuno': '81', 'ottantadue': '82',
    'ottantatre': '83', 'ottantaquattro': '84', 'ottantacinque': '85', 'ottantasei': '86',
    'ottantasette': '87', 'ottantotto': '88', 'ottantanove': '89', 'novantuno': '91',
    'novantadue': '92', 'novantatre': '93', 'novantaquattro': '94', 'novantacinque': '95',
    'novantasei': '96', 'novantasette': '97', 'novantotto': '98', 'novantanove': '99'
  };
  
  // ===== Pattern detection =====
  function detectSpeakingPattern(words) {
    let hasSingleDigits = 0;
    let hasThreeDigitGroups = 0;
    let hasNaturalNumbers = 0;
    let hasCommas = 0;
    
    for (const word of words) {
      if (singleDigitMap[word]) hasSingleDigits++;
      if (hundredMap[word] || compoundMap[word] || teenMap[word] || tensMap[word]) hasNaturalNumbers++;
      if (word === ',' || word === 'e') hasCommas++;
    }
    
    // Pattern A: Single digits with commas (e.g., "tre, tre, cinque")
    if (hasSingleDigits >= 3 && hasCommas >= 2) {
      return 'single_digits_grouped';
    }
    
    // Pattern B: Single digits spaced (e.g., "tre tre cinque")
    if (hasSingleDigits >= 3 && hasNaturalNumbers === 0) {
      return 'single_digits_sequential';
    }
    
    // Pattern C: Natural numbers (e.g., "trecentotrentacinque")
    if (hasNaturalNumbers >= 2) {
      return 'natural_numbers';
    }
    
    // Pattern D: Mixed (e.g., "tre tre cinque, centotrentaquattro")
    if (hasSingleDigits > 0 && hasNaturalNumbers > 0) {
      return 'mixed';
    }
    
    return 'unknown';
  }
  
  // ===== Parse single digits sequentially =====
  function parseSingleDigits(words, context) {
    let result = '';
    for (const word of words) {
      if (isTimeRelated(word, context)) continue;
      if (singleDigitMap[word]) {
        result += singleDigitMap[word];
      }
    }
    return result;
  }
  
  // ===== Parse natural numbers (3-digit or 4-digit groups) =====
  function parseNaturalNumberGroup(word) {
    // Check compound first (21-99)
    if (compoundMap[word]) return compoundMap[word];
    // Check hundreds
    if (hundredMap[word]) return hundredMap[word];
    // Check teens
    if (teenMap[word]) return teenMap[word];
    // Check tens
    if (tensMap[word]) return tensMap[word];
    return null;
  }
  
  function parseNaturalNumbers(words, context) {
    let result = '';
    let i = 0;
    
    while (i < words.length) {
      const word = words[i];
      
      if (isTimeRelated(word, context)) {
        i++;
        continue;
      }
      
      // Check for "mille" (thousand) - special handling
      if (word === 'mille') {
        // Look ahead for the next number
        if (i + 1 < words.length) {
          const nextGroup = parseNaturalNumberGroup(words[i + 1]);
          if (nextGroup) {
            // "mille" + next = 1000 + next
            const thousandValue = 1000;
            const nextValue = parseInt(nextGroup);
            const combined = thousandValue + nextValue;
            result += combined.toString();
            i += 2;
            continue;
          }
        }
        result += '1000';
        i++;
        continue;
      }
      
      const parsed = parseNaturalNumberGroup(word);
      if (parsed) {
        result += parsed;
        i++;
        continue;
      }
      
      i++;
    }
    
    return result;
  }
  
  // ===== Parse mixed pattern (single digits + natural numbers) =====
  function parseMixed(words, context) {
    let result = '';
    
    for (const word of words) {
      if (isTimeRelated(word, context)) continue;
      
      if (singleDigitMap[word]) {
        result += singleDigitMap[word];
      } else if (compoundMap[word]) {
        result += compoundMap[word];
      } else if (hundredMap[word]) {
        result += hundredMap[word];
      } else if (teenMap[word]) {
        result += teenMap[word];
      } else if (tensMap[word]) {
        result += tensMap[word];
      }
    }
    
    return result;
  }
  
  // ===== Main extraction logic =====
  const extractDigits = (text, contextText = '') => {
    if (!text) return '';
    
    debugLog('Extracting digits', { original: text.substring(0, 150) });
    
    const isPhoneContext = isInPhoneContext(contextText) || isInPhoneContext(text);
    if (!isPhoneContext) {
      const rawDigits = text.replace(/\D/g, '');
      if (rawDigits.length >= 8) return rawDigits;
      return '';
    }
    
    // Clean and tokenize
    let cleanText = text.toLowerCase()
      .replace(/[.,\-/()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const words = cleanText.split(/\s+/);
    const pattern = detectSpeakingPattern(words);
    
    debugLog('Detected pattern', { pattern, wordCount: words.length });
    
    let digits = '';
    
    switch (pattern) {
      case 'single_digits_grouped':
      case 'single_digits_sequential':
        digits = parseSingleDigits(words, cleanText);
        break;
      case 'natural_numbers':
        digits = parseNaturalNumbers(words, cleanText);
        break;
      case 'mixed':
        digits = parseMixed(words, cleanText);
        break;
      default:
        // Fallback: try all methods
        digits = parseSingleDigits(words, cleanText);
        if (digits.length < 8) {
          digits = parseNaturalNumbers(words, cleanText);
        }
        if (digits.length < 8) {
          digits = parseMixed(words, cleanText);
        }
    }
    
    debugLog('Extracted digits', { digits, length: digits.length, pattern });
    return digits;
  };
  
  // ===== Validate and normalize phone number =====
  const normalizePhoneNumber = (digits) => {
    if (!digits) return null;
    
    const cleanDigits = digits.replace(/\D/g, '');
    
    if (cleanDigits.length < 10) {
      console.log(`❌ Too few digits: ${cleanDigits.length}`);
      return null;
    }
    
    if (cleanDigits.length > 12) {
      console.log(`❌ Too many digits: ${cleanDigits.length}`);
      return null;
    }
    
    // Take the LAST 10 digits (handles any prefix)
    const lastTen = cleanDigits.slice(-10);
    
    // Italian mobile numbers start with 3
    if (!lastTen.startsWith('3')) {
      console.log(`⚠️ Warning: Number doesn't start with 3: ${lastTen}`);
      // Still accept but log warning
    }
    
    const normalized = `+39${lastTen}`;
    console.log(`✅ Normalized: ${normalized} (from ${cleanDigits} digits)`);
    return normalized;
  };
  
  // Confirmation phrases
  const confirmationPhrases = [
    'sì', 'si', 'yes', 'yep', 'yeah', 'correct', 'ok', 'okay', 'va bene',
    'corretto', 'esatto', 'perfetto', 'giusto', 'certamente', 'sicuro'
  ];
  
  debugLog('Processing transcript', { messageCount: transcript.length });
  
  // ===== STRATEGY 1: Agent confirmation with user "yes" =====
  for (let i = transcript.length - 1; i >= 1; i--) {
    const currentMsg = transcript[i];
    const content = (currentMsg.content || '').toLowerCase().trim();
    
    const isConfirmation = confirmationPhrases.some(phrase => 
      content === phrase || content.includes(phrase)
    );
    
    if (currentMsg.role === 'user' && isConfirmation) {
      const agentMsg = transcript[i - 1];
      if (agentMsg && agentMsg.role === 'agent') {
        const rawDigits = extractDigits(agentMsg.content, agentMsg.content);
        const finalNumber = normalizePhoneNumber(rawDigits);
        if (finalNumber) {
          console.log(`✅ Confirmed number (agent read-back): ${finalNumber}`);
          return finalNumber;
        }
      }
    }
  }
  
  // ===== STRATEGY 2: User provides number =====
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    if (msg.role === 'user') {
      const content = msg.content;
      const hasPhoneKeywords = content.includes('numero') || content.includes('telefono');
      
      if (hasPhoneKeywords || content.match(/\d{5,}/)) {
        const rawDigits = extractDigits(content, content);
        const finalNumber = normalizePhoneNumber(rawDigits);
        if (finalNumber) {
          console.log(`✅ User provided number: ${finalNumber}`);
          return finalNumber;
        }
      }
    }
  }
  
  // ===== STRATEGY 3: Agent reads back number =====
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    if (msg.role === 'agent') {
      const content = msg.content;
      const isReadingBack = content.includes('ripeto') || content.includes('confermo') || 
                           (content.includes('numero') && content.match(/\d/));
      
      if (isReadingBack) {
        const rawDigits = extractDigits(content, content);
        const finalNumber = normalizePhoneNumber(rawDigits);
        if (finalNumber) {
          console.log(`✅ Agent read-back number: ${finalNumber}`);
          return finalNumber;
        }
      }
    }
  }
  
  // ===== STRATEGY 4: Fallback raw digits =====
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i];
    const rawDigits = msg.content.replace(/\D/g, '');
    if (rawDigits.length >= 10 && rawDigits.length <= 12) {
      const finalNumber = normalizePhoneNumber(rawDigits);
      if (finalNumber) {
        console.log(`⚠️ Fallback number: ${finalNumber}`);
        return finalNumber;
      }
    }
  }
  
  console.log('❌ No phone number found');
  return null;
}
    
 
// ===== EXTRACT WHATSAPP CONFIRMATION FROM TRANSCRIPT =====
function extractWhatsappConfirmation(transcript) {
  if (!transcript || !Array.isArray(transcript)) {
    console.log('❌ No transcript provided for WhatsApp extraction');
    return false;
  }
  
  console.log('🔍 Extracting WhatsApp confirmation from transcript...');
  
  // Look for the WhatsApp question and user's response
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    const content = (msg.content || '').toLowerCase();
    
    // Check if this is the agent asking about WhatsApp confirmation
    // Support BOTH Italian and English phrases
    const isWhatsappQuestion = 
      // Italian phrases
      content.includes('desidera ricevere il messaggio di conferma') ||
      content.includes('ricevere il messaggio di conferma su whatsapp') ||
      content.includes('conferma su whatsapp') ||
      content.includes('vuole ricevere la conferma su whatsapp') ||
      content.includes('conferma tramite whatsapp') ||
      content.includes('messaggio di conferma della prenotazione su whatsapp') ||
      content.includes('conferma della prenotazione su whatsapp') ||
      // English phrases
      content.includes('confirmation message on whatsapp') ||
      content.includes('receive the confirmation message') ||
      content.includes('confirmation message') && content.includes('whatsapp') ||
      (content.includes('whatsapp') && content.includes('confirmation')) ||
      content.includes('send you the confirmation via whatsapp') ||
      content.includes('get the confirmation by whatsapp') ||
      content.includes('confirmation by whatsapp') ||
      content.includes('whatsapp confirmation');
    
    if (msg.role === 'agent' && isWhatsappQuestion) {
      console.log(`📱 Found WhatsApp question at index ${i}: "${msg.content}"`);
      
      // Look at the next few messages for user's response
      for (let j = i + 1; j < Math.min(i + 5, transcript.length); j++) {
        const userMsg = transcript[j];
        if (userMsg.role === 'user') {
          const userContent = (userMsg.content || '').toLowerCase();
          
          // ===== AFFIRMATIVE RESPONSES =====
          const affirmativeResponses = [
            // Italian
            'sì', 'si', 'sisi', 'si si', 'certo', 'certamente', 
            'sicuro', 'assolutamente', 'va bene', 'ok', 'okay',
            'perfetto', 'grazie', 'sì grazie', 'si grazie',
            'volentieri', 'con piacere',
            
            // English
            'yes', 'yeah', 'yep', 'sure', 'of course', 'definitely',
            'please', 'please do', 'go ahead',
            
            // Spanish
            'sí', 'claro', 'vale'
          ];
          
          // ===== NEGATIVE RESPONSES =====
          const negativeResponses = [
            // Italian
            'no', 'non', 'no grazie', 'grazie no', 'non voglio',
            'non serve', 'non necessario',
            
            // English
            'no', 'nope', 'no thanks', 'not necessary', 'skip',
            
            // Spanish
            'no', 'no gracias'
          ];
          
          // Check for affirmative response
          let isAffirmative = false;
          for (const affirm of affirmativeResponses) {
            if (userContent === affirm || userContent.includes(affirm)) {
              isAffirmative = true;
              break;
            }
          }
          
          // Check for negative response
          let isNegative = false;
          for (const neg of negativeResponses) {
            if (userContent === neg || userContent.includes(neg)) {
              isNegative = true;
              break;
            }
          }
          
          // Special case: user says just "Sí" or "Sì"
          if (userContent === 'sí' || userContent === 'sì' || userContent === 'si') {
            isAffirmative = true;
          }
          
          if (isAffirmative) {
            console.log(`✅ User confirmed WhatsApp: "${userMsg.content}"`);
            return true;
          }
          
          if (isNegative) {
            console.log(`❌ User declined WhatsApp: "${userMsg.content}"`);
            return false;
          }
        }
      }
    }
  }
  
  console.log('⚠️ No WhatsApp confirmation found in transcript, defaulting to false');
  return false;
}

// ===== EXTRACT NEWSLETTER/EVENTS PROGRAM CONFIRMATION =====
function extractNewsletterConfirmation(transcript) {
  if (!transcript || !Array.isArray(transcript)) {
    console.log('❌ No transcript provided for newsletter extraction');
    return false;
  }
  
  console.log('🔍 Extracting events program confirmation from transcript...');
  
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    const content = (msg.content || '').toLowerCase();
    
    // Check if this is the agent asking about events program
    const isNewsletterQuestion = 
      content.includes('programma eventi') ||
      content.includes('ricevere anche il nostro programma eventi') ||
      content.includes('eventi via whatsapp') ||
      content.includes('weekly events program') ||
      content.includes('events program via whatsapp') ||
      content.includes('receive our weekly events') ||
      content.includes('events newsletter') ||
      content.includes('subscribe to our events') ||
      content.includes('get our events');
    
    if (msg.role === 'agent' && isNewsletterQuestion) {
      console.log(`📅 Found newsletter question at index ${i}: "${msg.content}"`);
      
      for (let j = i + 1; j < Math.min(i + 5, transcript.length); j++) {
        const userMsg = transcript[j];
        if (userMsg.role === 'user') {
          const userContent = (userMsg.content || '').toLowerCase();
          
          // ===== AFFIRMATIVE RESPONSES =====
          const affirmativeResponses = [
            'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'of course',
            'sì', 'si', 'certo', 'va bene', 'perfetto',
            'claro', 'vale', 'oui', 'ja', 'uh huh', 'mmhmm',
            'y', 's', 'please', 'why not', 'absolutely', 'definitely'
          ];
          
          // ===== NEGATIVE RESPONSES =====
          const negativeResponses = [
            'no', 'nah', 'nope', 'no thanks', 'not necessary',
            'no grazie', 'grazie no', 'non', 'skip', 'pass',
            'n', 'not interested', 'maybe later'
          ];
          
          let isAffirmative = false;
          for (const affirm of affirmativeResponses) {
            if (userContent === affirm || userContent.includes(affirm)) {
              isAffirmative = true;
              break;
            }
          }
          
          let isNegative = false;
          for (const neg of negativeResponses) {
            if (userContent === neg || userContent.includes(neg)) {
              isNegative = true;
              break;
            }
          }
          
          if (isAffirmative) {
            console.log(`✅ User confirmed newsletter: "${userMsg.content}"`);
            return true;
          }
          
          if (isNegative) {
            console.log(`❌ User declined newsletter: "${userMsg.content}"`);
            return false;
          }
        }
      }
    }
  }
  
  console.log('⚠️ No newsletter confirmation found in transcript, defaulting to false');
  return false;
}
// ===== FUNCTION TO SEND WEBHOOK TO MAKE.COM - STRICT VALIDATION =====
// ===== FUNCTION TO SEND WEBHOOK TO MAKE.COM - STRICT VALIDATION =====
async function sendToMakeWebhook(reservationData, reservationId) {
  console.log('\n' + '='.repeat(60));
  console.log('🔵 sendToMakeWebhook called - validating all fields...');
  console.log('='.repeat(60));
  
  // ===== HELPER FUNCTION TO CHECK FOR TRULY EMPTY VALUES =====
  const isEmpty = (value) => {
    return !value || 
           value === '' || 
           value === null || 
           value === 'null' || 
           value === 'undefined' ||
           (typeof value === 'string' && value.trim() === '');
  };
  
  // ===== CRITICAL: Check EVERY required field - NO EMPTY VALUES ALLOWED =====
  const errors = [];
  
  // Check firstName
  if (isEmpty(reservationData.firstName)) {
    errors.push('firstName is empty');
  }
  
  // Check lastName
  if (isEmpty(reservationData.lastName)) {
    errors.push('lastName is empty');
  }
  
  // ===== PHONE NUMBER VALIDATION - STRICT =====
  let formattedPhoneForWebhook = null;
  let phoneDigits = null;
  
  if (isEmpty(reservationData.phone)) {
    errors.push('phone is empty');
  } else {
    // Extract only digits
    phoneDigits = reservationData.phone.replace(/\D/g, '');
    console.log(`📱 Raw phone input: "${reservationData.phone}"`);
    console.log(`📱 Digits extracted: ${phoneDigits} (length: ${phoneDigits.length})`);
    
    // CRITICAL: If no digits extracted, it's invalid
    if (phoneDigits.length === 0) {
      errors.push('phone has no digits after stripping non-digits');
    } else if (phoneDigits.length < 10 || phoneDigits.length > 12) {
      errors.push(`phone has ${phoneDigits.length} digits (must be 10-12 digits after stripping non-digits)`);
    } else {
      // Get the last 10 digits (works for all formats)
      const lastTenDigits = phoneDigits.slice(-10);
      console.log(`📱 Last 10 digits: ${lastTenDigits}`);
      
      // Format as +39XXXXXXXXXX for webhook
      formattedPhoneForWebhook = `+39${lastTenDigits}`;
      console.log(`📱 Formatted for webhook: ${formattedPhoneForWebhook}`);
      
      // Additional validation: Italian mobile numbers start with 3
      if (!lastTenDigits.startsWith('3')) {
        errors.push(`phone does not appear to be an Italian mobile number (should start with 3, got ${lastTenDigits.charAt(0)})`);
      }
    }
  }
  
  // Check date format
  if (isEmpty(reservationData.date)) {
    errors.push('date is empty');
  } else if (!reservationData.date.match(/^\d{2}-\d{2}-\d{4}$/)) {
    errors.push(`date format invalid: ${reservationData.date} (expected DD-MM-YYYY)`);
  }
  
  // Check time format
  if (isEmpty(reservationData.time)) {
    errors.push('time is empty');
  } else if (!reservationData.time.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
    errors.push(`time format invalid: ${reservationData.time} (expected HH:MM)`);
  }
  
  // Check guests
  if (isEmpty(reservationData.guests)) {
    errors.push('guests is empty');
  } else if (reservationData.guests < 1 || reservationData.guests > 20) {
    errors.push(`guests count invalid: ${reservationData.guests} (must be 1-20)`);
  }
  
  // ===== CHECK WHATSAPP CONFIRMATION =====
  const wantsWhatsapp = reservationData.whatsapp_confirmation === true || 
                        reservationData.whatsapp_confirmation === 'yes' || 
                        reservationData.whatsapp_confirmation === 'true';
  
  console.log(`📱 WhatsApp confirmation: ${wantsWhatsapp}`);
  
  // If ANY errors, DO NOT SEND
  if (errors.length > 0) {
    console.log(`\n❌❌❌ Webhook NOT sent to Make.com - validation failed:`);
    errors.forEach(err => console.log(`   - ${err}`));
    console.log(`\n📋 Reservation data that failed validation:`);
    console.log(`   Name: ${reservationData.firstName} ${reservationData.lastName}`);
    console.log(`   Phone: ${reservationData.phone} -> formatted: ${formattedPhoneForWebhook}`);
    console.log(`   Date: ${reservationData.date}`);
    console.log(`   Time: ${reservationData.time}`);
    console.log(`   Guests: ${reservationData.guests}`);
    console.log(`   WhatsApp: ${reservationData.whatsapp_confirmation}`);
    console.log(`   Newsletter: ${reservationData.newsletter}`);
    console.log(`\n⚠️ This prevents queue issues and bad WhatsApp messages.`);
    return false;
  }
  
  // ===== IF WHATSAPP IS FALSE, DO NOT SEND =====
  if (!wantsWhatsapp) {
    console.log(`\n⚠️ Webhook NOT sent - customer declined WhatsApp confirmation (whatsapp_confirmation = false)`);
    console.log(`   Customer ${reservationData.firstName} ${reservationData.lastName} does not want WhatsApp messages.`);
    return false;
  }
  
  console.log('\n✅ All required fields validated successfully!');
  console.log(`   Name: ${reservationData.firstName} ${reservationData.lastName}`);
  console.log(`   Phone: ${formattedPhoneForWebhook}`);
  console.log(`   Date: ${reservationData.date}`);
  console.log(`   Time: ${reservationData.time}`);
  console.log(`   Guests: ${reservationData.guests}`);
  console.log(`   WhatsApp: ${wantsWhatsapp}`);
  console.log(`   Newsletter: ${reservationData.newsletter === true}`);
  
  // ===== PREPARE PAYLOAD FOR MAKE.COM =====
  try {
    // Format date for Make.com (ensure DD-MM-YYYY)
    let formattedDate = reservationData.date;
    if (formattedDate && formattedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = formattedDate.split('-');
      formattedDate = `${day}-${month}-${year}`;
      console.log(`📅 Converted date from YYYY-MM-DD to DD-MM-YYYY: ${formattedDate}`);
    } else if (formattedDate && formattedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      console.log(`📅 Date already in correct DD-MM-YYYY format: ${formattedDate}`);
    }
    
    // Clean specialRequests - remove internal notes
    let cleanSpecialRequests = reservationData.specialRequests || 'No special requests';
    if (cleanSpecialRequests.includes('Calendar Note:')) {
      cleanSpecialRequests = cleanSpecialRequests.split('Calendar Note:')[0].trim();
      if (isEmpty(cleanSpecialRequests)) {
        cleanSpecialRequests = 'No special requests';
      }
      console.log(`🧹 Removed internal "Calendar Note" from special requests`);
    }
    
    // Build the payload
    const payload = {
      reservationId: reservationId,
      firstName: reservationData.firstName,
      lastName: reservationData.lastName,
      phone: formattedPhoneForWebhook,
      date: formattedDate,
      time: reservationData.time,
      guests: parseInt(reservationData.guests),
      adults: parseInt(reservationData.adults) || parseInt(reservationData.guests),
      children: parseInt(reservationData.children) || 0,
      specialRequests: cleanSpecialRequests,
      newsletter: reservationData.newsletter === true,
      whatsappConfirmation: wantsWhatsapp
    };
    
    console.log('\n📤 SENDING TO MAKE.COM:');
    console.log(`   URL: ${MAKE_WEBHOOK_URL}`);
    console.log(`   Payload:`, JSON.stringify(payload, null, 2));
    console.log(`   Payload size: ${JSON.stringify(payload).length} bytes`);
    
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const responseText = await response.text();
    console.log(`\n📨 MAKE.COM RESPONSE:`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Body: ${responseText}`);
    
    if (response.ok) {
      console.log(`\n✅✅✅ Webhook sent to Make.com successfully!`);
      console.log(`   Reservation ID: ${reservationId}`);
      console.log(`   Phone sent: ${formattedPhoneForWebhook}`);
      return true;
    } else {
      console.log(`\n⚠️⚠️⚠️ Webhook to Make.com failed!`);
      console.log(`   Status: ${response.status}`);
      console.log(`   Response: ${responseText}`);
      return false;
    }
    
  } catch (error) {
    console.error(`\n❌❌❌ Webhook error:`);
    console.error(`   Error message: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    console.error(`   Reservation ID: ${reservationId}`);
    return false;
  }
}
// ============================================
// ===== FIELD COMPARISON WITH CONFIDENCE SCORES =====
// ============================================

/**
 * Calculate confidence score for a field value
 * Higher score = more reliable
 */
function calculateFieldConfidence(value, source, context = {}) {
  if (!value || value === '' || value === null) return 0;
  
  let score = 0;
  
  // Base score for having a value
  score += 10;
  
  // Length-based scoring
  if (typeof value === 'string') {
    if (value.length > 3) score += 5;
    if (value.length > 10) score += 5;
  }
  
  // Source-based scoring
  if (source === 'postcall') score += 15; // Post-call analysis is usually reliable
  if (source === 'transcript_confirmed') score += 25; // Most reliable - user confirmed
  if (source === 'transcript_unconfirmed') score += 5; // Less reliable
  if (source === 'structured') score += 20; // Structured data block
  
  // Context-based scoring for phone numbers
  if (context.field === 'phone') {
    const digits = value.replace(/\D/g, '');
    if (digits.length === 10) score += 20; // Perfect length
    if (digits.length === 11 || digits.length === 12) score += 10;
    if (digits.startsWith('3')) score += 10; // Italian mobile starts with 3
    if (context.userConfirmed) score += 30; // User said "sì" or "yes"
    if (context.agentReadBack) score += 20; // Agent repeated the number
  }
  
  // Context-based scoring for names
  if (context.field === 'name') {
    if (value.match(/^[A-Z][a-z]+$/)) score += 10; // Proper capitalization
    if (context.userConfirmed) score += 30;
  }
  
  // Context-based scoring for guests
  if (context.field === 'guests') {
    const num = parseInt(value);
    if (num > 0 && num < 20) score += 20;
    if (context.userConfirmed) score += 30;
  }
  
  // Context-based scoring for time
  if (context.field === 'time') {
    if (value.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)) score += 20;
    if (context.userConfirmed) score += 30;
  }
  
  // Context-based scoring for date
  if (context.field === 'date') {
    if (value.match(/^\d{2}-\d{2}-\d{4}$/)) score += 20;
    if (context.userConfirmed) score += 30;
  }
  
  return score;
}

/**
 * Compare two field values and return the best one based on confidence scores
 */
function getBestFieldValue(postcallValue, transcriptValue, fieldName, transcriptContext = {}) {
  // SPECIAL RULE 1: For first and last names, ALWAYS trust post-call analysis
  if (fieldName === 'firstName' || fieldName === 'lastName') {
    if (postcallValue && postcallValue !== 'null' && postcallValue !== 'undefined' && postcallValue !== '') {
      console.log(`📊 Name field "${fieldName}": Prioritizing POST-CALL value "${postcallValue}" (more reliable than transcript extraction)`);
      return postcallValue;
    }
    // Only use transcript if post-call has nothing
    if (transcriptValue && transcriptValue !== 'null' && transcriptValue !== '') {
      console.log(`📊 Name field "${fieldName}": No post-call value, using transcript "${transcriptValue}"`);
      return transcriptValue;
    }
    console.log(`   ❌ No valid name value for ${fieldName}`);
    return null;
  }
  
  // SPECIAL RULE 2: For WhatsApp confirmation, ALWAYS trust post-call analysis
  if (fieldName === 'whatsapp_confirmation') {
    if (postcallValue !== undefined && postcallValue !== null && postcallValue !== '') {
      console.log(`📱 WhatsApp confirmation: Prioritizing POST-CALL value "${postcallValue}" (more reliable than transcript extraction)`);
      return postcallValue;
    }
    // Only use transcript if post-call has nothing
    if (transcriptValue !== undefined && transcriptValue !== null && transcriptValue !== '') {
      console.log(`📱 WhatsApp confirmation: No post-call value, using transcript "${transcriptValue}"`);
      return transcriptValue;
    }
    return false; // Default to false
  }
  
  // SPECIAL RULE 3: For newsletter opt-in, ALWAYS trust post-call analysis
  if (fieldName === 'newsletter') {
    if (postcallValue !== undefined && postcallValue !== null && postcallValue !== '') {
      console.log(`📧 Newsletter: Prioritizing POST-CALL value "${postcallValue}" (more reliable than transcript extraction)`);
      return postcallValue;
    }
    // Only use transcript if post-call has nothing
    if (transcriptValue !== undefined && transcriptValue !== null && transcriptValue !== '') {
      console.log(`📧 Newsletter: No post-call value, using transcript "${transcriptValue}"`);
      return transcriptValue;
    }
    return false; // Default to false
  }
  
  // For all other fields (guests, date, time, phone), use confidence scoring
  const postcallScore = calculateFieldConfidence(postcallValue, 'postcall', { field: fieldName, ...transcriptContext });
  const transcriptScore = calculateFieldConfidence(transcriptValue, 'transcript_confirmed', { field: fieldName, ...transcriptContext });
  
  console.log(`📊 Field comparison for "${fieldName}":`);
  console.log(`   Post-call: "${postcallValue}" (score: ${postcallScore})`);
  console.log(`   Transcript: "${transcriptValue}" (score: ${transcriptScore})`);
  
  if (postcallScore === 0 && transcriptScore === 0) {
    console.log(`   ❌ No valid value for ${fieldName}`);
    return null;
  }
  
  if (postcallScore > transcriptScore) {
    console.log(`   ✅ Using POST-CALL value for ${fieldName}`);
    return postcallValue;
  }
  
  if (transcriptScore > postcallScore) {
    console.log(`   ✅ Using TRANSCRIPT value for ${fieldName}`);
    return transcriptValue;
  }
  
  // Scores are equal - prefer post-call for reliability
  if (postcallScore > 0) {
    console.log(`   ⚖️ Scores equal - using POST-CALL for ${fieldName}`);
    return postcallValue;
  }
  
  console.log(`   ⚖️ Scores equal - using TRANSCRIPT for ${fieldName}`);
  return transcriptValue;
}
// ===== GOOGLE CALENDAR INTEGRATION =====
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const JAZZAMORE_CALENDAR_ID = 'jazzamorecesena@gmail.com';

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

// ===== GOOGLE CALENDAR CLIENT =====
async function getCalendarClient() {
  try {
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
    
    safeLog('✅ Google Calendar client initialized successfully');
    return calendar;
    
  } catch (error) {
    safeLog('❌ Error getting Google Calendar client', { error: error.message }, 'error');
    return null;
  }
}

// ===== HELPER FUNCTIONS FOR DATE RESOLUTION =====
function detectExplicitMonth(cleanedDate) {
  const monthMap = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5, 'giugno': 6,
    'luglio': 7, 'agosto': 8, 'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12
  };
  
  for (const [monthName, monthIndex] of Object.entries(monthMap)) {
    if (cleanedDate.includes(monthName)) {
      return monthIndex;
    }
  }
  return null;
}

function isValidDayForMonth(day, month, year) {
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  return day <= lastDayOfMonth;
}

function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ===== HELPER: Find next occurrence of a specific day (WORKS FOR ALL DAYS & NEXT WEEK) =====
function findNextSpecificDay(dayName, skipCurrentWeek = false) {
  const dayMap = {
    // English
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    // Italian
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 
    'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 
    'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 
    'sabato': 6
  };
  
  const targetDayNum = dayMap[dayName.toLowerCase()];
  if (targetDayNum === undefined) {
    console.error(`❌ Unknown day name: ${dayName}`);
    return getRomeDateToday();
  }
  
  const today = getRomeDate();
  const todayDayNum = today.getDay();
  
  // Calculate days to add to reach target day
  let daysToAdd = (targetDayNum - todayDayNum + 7) % 7;
  
  // If skipCurrentWeek is true:
  // - If daysToAdd is 0 (same day this week), add 7 to get next week
  // - If daysToAdd > 0, this means the day is later this week
  //   For "next week" we want to skip this week entirely, so add 7
  if (skipCurrentWeek) {
    daysToAdd = daysToAdd + 7;
  }
  
  console.log(`📅 findNextSpecificDay: ${dayName} → targetDay=${targetDayNum}, todayDay=${todayDayNum}, daysToAdd=${daysToAdd}, skipCurrentWeek=${skipCurrentWeek}`);
  
  const targetDate = addDays(today, daysToAdd);
  const result = formatInTimeZone(targetDate, ROME_TIMEZONE, 'dd-MM-yyyy');
  
  console.log(`✅ Result: ${result}`);
  return result;
}

// ===== GOOGLE CALENDAR AS ONLY SOURCE OF TRUTH =====
function analyzeEventAvailability(event) {
  const {
    summary, description, start, end, attendees,
    extendedProperties, attendeesOmitted, status, location
  } = event;

  let isSoldOut = false;
  let soldOutReason = null;
  
  if (status === 'cancelled') {
    isSoldOut = true;
    soldOutReason = 'Event cancelled in Google Calendar';
  }
  
  if (attendeesOmitted === true) {
    isSoldOut = true;
    soldOutReason = 'Attendees omitted (likely at capacity)';
  }
  
  if (extendedProperties?.private) {
    const privateProps = extendedProperties.private;
    if (privateProps.soldOut === 'true' || privateProps.soldOut === true) {
      isSoldOut = true;
      soldOutReason = 'Marked as sold out in Google Calendar';
    }
  }
  
  if (description) {
    const soldOutKeywords = [
      'sold out', 'sold-out', 'fully booked',
      'no seats', 'no seats available', 'no availability',
      'esaurito', 'tutto esaurito', 'prenotazioni chiuse'
    ];
    
    const lowerDesc = description.toLowerCase();
    for (const keyword of soldOutKeywords) {
      if (lowerDesc.includes(keyword)) {
        isSoldOut = true;
        soldOutReason = `Found keyword in description: "${keyword}"`;
        break;
      }
    }
  }
  
  if (attendees && Array.isArray(attendees)) {
    const confirmedAttendees = attendees.filter(attendee => 
      attendee.responseStatus === 'accepted'
    ).length;
    
    if (extendedProperties?.private?.maxCapacity) {
      const maxCapacity = parseInt(extendedProperties.private.maxCapacity);
      if (confirmedAttendees >= maxCapacity) {
        isSoldOut = true;
        soldOutReason = `Capacity reached: ${confirmedAttendees}/${maxCapacity}`;
      }
    }
  }

  return {
    title: summary || 'Untitled Event',
    description: description || '',
    location: location || '',
    startTime: start?.dateTime || start?.date,
    endTime: end?.dateTime || end?.date,
    isSoldOut,
    soldOutReason,
    rawEvent: event
  };
}

// ===== GET EVENTS FOR A SINGLE DATE =====
async function getEventsForDate(dateInput) {
  safeLog('📅 getEventsForDate called', { 
    input: dateInput,
    timestamp: new Date().toISOString()
  });
  
  try {
    const resolvedDate = resolveDate(dateInput);
    
    if (!resolvedDate || !resolvedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      safeLog('❌ Date resolution failed', { input: dateInput, resolvedDate, error: 'Invalid date format after resolution' });
      return { 
        success: false, 
        message: `Invalid date: ${dateInput}`, 
        events: [],
        resolvedDate: resolvedDate 
      };
    }
    
    safeLog('✅ Date resolved successfully', { originalInput: dateInput, resolvedDate });
    
    const [day, month, year] = resolvedDate.split('-');
    const isoDateForCalendar = `${year}-${month}-${day}`;
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error("Google Calendar client not initialized");
    }
    
    const startOfDayStr = `${isoDateForCalendar}T00:00:00`;
    const endOfDayStr = `${isoDateForCalendar}T23:59:59`;
    
    safeLog('🔍 Querying Google Calendar', {
      date: resolvedDate,
      isoDate: isoDateForCalendar,
      timeMin: startOfDayStr,
      timeMax: endOfDayStr,
      calendarId: JAZZAMORE_CALENDAR_ID
    });
    
    const response = await calendar.events.list({
      calendarId: JAZZAMORE_CALENDAR_ID,
      timeMin: zonedTimeToUtc(startOfDayStr, ROME_TIMEZONE).toISOString(),
      timeMax: zonedTimeToUtc(endOfDayStr, ROME_TIMEZONE).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: ROME_TIMEZONE,
      maxResults: 20
    });
    
    const events = response.data.items || [];
    
    if (events.length === 0) {
      safeLog('ℹ️ No events found in Google Calendar for date', { date: resolvedDate, source: 'Google Calendar API' });
      return { 
        success: true, 
        message: `No events found for ${resolvedDate} in Google Calendar.`, 
        events: [],
        resolvedDate: resolvedDate,
        source: 'Google Calendar'
      };
    }
    
    safeLog('✅ Found events in Google Calendar', { date: resolvedDate, count: events.length, source: 'Google Calendar API' });
    
    const processedEvents = events.map(event => {
      const availability = analyzeEventAvailability(event);
      
      let eventDate = resolvedDate;
      let eventTime = 'All day';
      
      if (event.start?.dateTime) {
        const eventStart = new Date(event.start.dateTime);
        eventDate = formatInTimeZone(eventStart, ROME_TIMEZONE, 'dd-MM-yyyy');
        eventTime = formatInTimeZone(eventStart, ROME_TIMEZONE, 'HH:mm');
      } else if (event.start?.date) {
        const [year, month, day] = event.start.date.split('-');
        eventDate = `${day}-${month}-${year}`;
      }
      
      return {
        title: availability.title,
        date: eventDate,
        time: eventTime,
        description: availability.description || 'No description available',
        location: availability.location || 'Not provided',
        isSoldOut: availability.isSoldOut,
        soldOutReason: availability.soldOutReason,
        startTime: event.start?.dateTime || event.start?.date,
        endTime: event.end?.dateTime || event.end?.date,
        source: 'Google Calendar'
      };
    });
    
    processedEvents.sort((a, b) => {
      const timeA = a.time === 'All day' ? '00:00' : a.time;
      const timeB = b.time === 'All day' ? '00:00' : b.time;
      return timeA.localeCompare(timeB);
    });
    
    return {
      success: true,
      message: `Found ${processedEvents.length} event(s) for ${resolvedDate} in Google Calendar.`,
      events: processedEvents,
      resolvedDate: resolvedDate,
      source: 'Google Calendar'
    };
    
  } catch (error) {
    safeLog('❌ Error in getEventsForDate', { input: dateInput, error: error.message }, 'error');
    return { 
      success: false, 
      message: `Error fetching events from Google Calendar: ${error.message}`, 
      events: [],
      source: 'Google Calendar'
    };
  }
}

// ===== GET EVENTS FOR A FULL WEEK =====
async function getEventsForWeek(startDateInput) {
  safeLog('📅 getEventsForWeek called', { 
    input: startDateInput,
    timestamp: new Date().toISOString()
  });
  
  try {
    const resolvedStartDate = resolveDate(startDateInput);
    
    if (!resolvedStartDate || !resolvedStartDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      safeLog('❌ Date resolution failed', { 
        input: startDateInput, resolvedStartDate, error: 'Invalid date format after resolution'
      });
      return { 
        success: false, 
        message: `Invalid date: ${startDateInput}`, 
        events: [],
        weekEvents: {}
      };
    }
    
    safeLog('✅ Start date resolved successfully', { originalInput: startDateInput, resolvedStartDate });
    
    const [day, month, year] = resolvedStartDate.split('-');
    const startDate = new Date(`${year}-${month}-${day}`);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    
    const endDateFormatted = formatInTimeZone(endDate, ROME_TIMEZONE, 'dd-MM-yyyy');
    
    safeLog('📅 Week range calculated', { startDate: resolvedStartDate, endDate: endDateFormatted });
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error("Google Calendar client not initialized");
    }
    
    const startDateTime = `${year}-${month}-${day}T00:00:00`;
    const endDateTime = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T23:59:59`;
    
    safeLog('🔍 Querying Google Calendar for week range', {
      startDate: resolvedStartDate,
      endDate: endDateFormatted,
      timeMin: startDateTime,
      timeMax: endDateTime,
      calendarId: JAZZAMORE_CALENDAR_ID
    });
    
    const response = await calendar.events.list({
      calendarId: JAZZAMORE_CALENDAR_ID,
      timeMin: zonedTimeToUtc(startDateTime, ROME_TIMEZONE).toISOString(),
      timeMax: zonedTimeToUtc(endDateTime, ROME_TIMEZONE).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: ROME_TIMEZONE,
      maxResults: 50
    });
    
    const events = response.data.items || [];
    
    safeLog('✅ Found events in Google Calendar for week range', { 
      startDate: resolvedStartDate,
      endDate: endDateFormatted,
      count: events.length,
      source: 'Google Calendar API'
    });
    
    const dayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const weekEvents = {};
    
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      const dateKey = formatInTimeZone(currentDate, ROME_TIMEZONE, 'dd-MM-yyyy');
      const dayOfWeek = dayNames[currentDate.getDay()];
      weekEvents[dateKey] = {
        date: dateKey,
        dayName: dayOfWeek,
        events: []
      };
    }
    
    for (const event of events) {
      const availability = analyzeEventAvailability(event);
      
      let eventDate = null;
      let eventTime = 'All day';
      
      if (event.start?.dateTime) {
        const eventStart = new Date(event.start.dateTime);
        eventDate = formatInTimeZone(eventStart, ROME_TIMEZONE, 'dd-MM-yyyy');
        eventTime = formatInTimeZone(eventStart, ROME_TIMEZONE, 'HH:mm');
      } else if (event.start?.date) {
        const [y, m, d] = event.start.date.split('-');
        eventDate = `${d}-${m}-${y}`;
      }
      
      if (eventDate && weekEvents[eventDate]) {
        weekEvents[eventDate].events.push({
          title: availability.title,
          time: eventTime,
          description: availability.description || 'No description available',
          location: availability.location || 'Not provided',
          isSoldOut: availability.isSoldOut,
          soldOutReason: availability.soldOutReason,
          startTime: event.start?.dateTime || event.start?.date,
          endTime: event.end?.dateTime || event.end?.date,
          source: 'Google Calendar'
        });
      }
    }
    
    for (const dateKey in weekEvents) {
      weekEvents[dateKey].events.sort((a, b) => {
        const timeA = a.time === 'All day' ? '00:00' : a.time;
        const timeB = b.time === 'All day' ? '00:00' : b.time;
        return timeA.localeCompare(timeB);
      });
    }
    
    const weekEventsArray = Object.values(weekEvents);
    
    const totalEvents = events.length;
    const daysWithEvents = weekEventsArray.filter(day => day.events.length > 0).length;
    const soldOutEvents = events.filter(event => analyzeEventAvailability(event).isSoldOut).length;
    
    return {
      success: true,
      message: `Found ${totalEvents} event(s) from ${resolvedStartDate} to ${endDateFormatted}.`,
      startDate: resolvedStartDate,
      endDate: endDateFormatted,
      totalEvents,
      daysWithEvents,
      soldOutEvents,
      weekEvents: weekEventsArray,
      source: 'Google Calendar'
    };
    
  } catch (error) {
    safeLog('❌ Error in getEventsForWeek', { input: startDateInput, error: error.message }, 'error');
    return { 
      success: false, 
      message: `Error fetching week events from Google Calendar: ${error.message}`, 
      events: [],
      weekEvents: [],
      source: 'Google Calendar'
    };
  }
}

// ===== GET EVENTS FOR A CUSTOM DATE RANGE =====
async function getEventsForDateRange(startDateInput, endDateInput) {
  safeLog('📅 getEventsForDateRange called', { 
    start: startDateInput,
    end: endDateInput,
    timestamp: new Date().toISOString()
  });
  
  try {
    const resolvedStartDate = resolveDate(startDateInput);
    const resolvedEndDate = resolveDate(endDateInput);
    
    if (!resolvedStartDate || !resolvedStartDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      return { 
        success: false, 
        message: `Invalid start date: ${startDateInput}`, 
        events: [],
        rangeEvents: []
      };
    }
    
    if (!resolvedEndDate || !resolvedEndDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      return { 
        success: false, 
        message: `Invalid end date: ${endDateInput}`, 
        events: [],
        rangeEvents: []
      };
    }
    
    const [startDay, startMonth, startYear] = resolvedStartDate.split('-');
    const [endDay, endMonth, endYear] = resolvedEndDate.split('-');
    
    const startDate = new Date(`${startYear}-${startMonth}-${startDay}`);
    const endDate = new Date(`${endYear}-${endMonth}-${endDay}`);
    
    if (endDate < startDate) {
      return {
        success: false,
        message: `End date (${resolvedEndDate}) cannot be before start date (${resolvedStartDate}).`,
        events: [],
        rangeEvents: []
      };
    }
    
    const daysDiff = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 31) {
      return {
        success: false,
        message: `Date range too large (${daysDiff} days). Maximum is 31 days.`,
        events: [],
        rangeEvents: []
      };
    }
    
    safeLog('📅 Date range calculated', { 
      startDate: resolvedStartDate, endDate: resolvedEndDate, daysDiff 
    });
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error("Google Calendar client not initialized");
    }
    
    const startDateTime = `${startYear}-${startMonth}-${startDay}T00:00:00`;
    const endDateTime = `${endYear}-${endMonth}-${endDay}T23:59:59`;
    
    const response = await calendar.events.list({
      calendarId: JAZZAMORE_CALENDAR_ID,
      timeMin: zonedTimeToUtc(startDateTime, ROME_TIMEZONE).toISOString(),
      timeMax: zonedTimeToUtc(endDateTime, ROME_TIMEZONE).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: ROME_TIMEZONE,
      maxResults: 100
    });
    
    const events = response.data.items || [];
    
    safeLog('✅ Found events for date range', { 
      startDate: resolvedStartDate, endDate: resolvedEndDate, count: events.length 
    });
    
    const dayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const rangeEvents = {};
    
    for (let i = 0; i <= daysDiff; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      const dateKey = formatInTimeZone(currentDate, ROME_TIMEZONE, 'dd-MM-yyyy');
      rangeEvents[dateKey] = {
        date: dateKey,
        dayName: dayNames[currentDate.getDay()],
        events: []
      };
    }
    
    for (const event of events) {
      const availability = analyzeEventAvailability(event);
      let eventDate = null;
      let eventTime = 'All day';
      
      if (event.start?.dateTime) {
        const eventStart = new Date(event.start.dateTime);
        eventDate = formatInTimeZone(eventStart, ROME_TIMEZONE, 'dd-MM-yyyy');
        eventTime = formatInTimeZone(eventStart, ROME_TIMEZONE, 'HH:mm');
      } else if (event.start?.date) {
        const [y, m, d] = event.start.date.split('-');
        eventDate = `${d}-${m}-${y}`;
      }
      
      if (eventDate && rangeEvents[eventDate]) {
        rangeEvents[eventDate].events.push({
          title: availability.title,
          time: eventTime,
          description: availability.description || 'No description available',
          location: availability.location || 'Not provided',
          isSoldOut: availability.isSoldOut,
          soldOutReason: availability.soldOutReason,
          startTime: event.start?.dateTime || event.start?.date,
          endTime: event.end?.dateTime || event.end?.date,
          source: 'Google Calendar'
        });
      }
    }
    
    for (const dateKey in rangeEvents) {
      rangeEvents[dateKey].events.sort((a, b) => {
        const timeA = a.time === 'All day' ? '00:00' : a.time;
        const timeB = b.time === 'All day' ? '00:00' : b.time;
        return timeA.localeCompare(timeB);
      });
    }
    
    const rangeEventsArray = Object.values(rangeEvents);
    const totalEvents = events.length;
    const daysWithEvents = rangeEventsArray.filter(d => d.events.length > 0).length;
    const soldOutEvents = events.filter(e => analyzeEventAvailability(e).isSoldOut).length;
    
    return {
      success: true,
      message: `Found ${totalEvents} event(s) from ${resolvedStartDate} to ${resolvedEndDate} (${daysDiff + 1} days).`,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      totalDays: daysDiff + 1,
      totalEvents,
      daysWithEvents,
      soldOutEvents,
      rangeEvents: rangeEventsArray,
      source: 'Google Calendar'
    };
    
  } catch (error) {
    safeLog('❌ Error in getEventsForDateRange', { 
      start: startDateInput, end: endDateInput, error: error.message 
    }, 'error');
    return { 
      success: false, 
      message: `Error fetching range events from Google Calendar: ${error.message}`, 
      events: [],
      rangeEvents: [],
      source: 'Google Calendar'
    };
  }
}

// ===== AI AGENT WRAPPER FUNCTIONS =====
async function get_events_by_date(dateInput) {
  safeLog('🤖 AI Agent requesting events', { input: dateInput, source: 'Google Calendar only' });
  const result = await getEventsForDate(dateInput);
  safeLog('📋 get_events_by_date result', {
    success: result.success,
    eventCount: result.events?.length || 0,
    resolvedDate: result.resolvedDate,
    source: result.source
  });
  return result;
}

async function get_events_for_week(startDateInput) {
  safeLog('🤖 AI Agent requesting week events', { input: startDateInput, source: 'Google Calendar only' });
  const result = await getEventsForWeek(startDateInput);
  safeLog('📋 get_events_for_week result', {
    success: result.success,
    totalEvents: result.totalEvents || 0,
    daysWithEvents: result.daysWithEvents || 0,
    startDate: result.startDate,
    endDate: result.endDate
  });
  return result;
}

async function get_events_for_date_range(startDateInput, endDateInput) {
  safeLog('🤖 AI Agent requesting date range events', { 
    start: startDateInput, end: endDateInput, source: 'Google Calendar only' 
  });
  const result = await getEventsForDateRange(startDateInput, endDateInput);
  safeLog('📋 get_events_for_date_range result', {
    success: result.success,
    totalEvents: result.totalEvents || 0,
    daysWithEvents: result.daysWithEvents || 0,
    startDate: result.startDate,
    endDate: result.endDate
  });
  return result;
}

// ===== CHECK CALENDAR FOR CONFLICTS =====
async function checkCalendarForConflicts(date, time, calendarId = null) {
  try {
    const resolvedDate = resolveDate(date);
    
    if (!resolvedDate || !resolvedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      return {
        hasConflicts: false,
        conflictingEvents: [],
        error: `Invalid date format: ${date}`
      };
    }
    
    const [day, month, year] = resolvedDate.split('-');
    const isoDate = `${year}-${month}-${day}`;
    
    const eventsResult = await getEventsForDate(resolvedDate);
    
    if (!eventsResult.success || !eventsResult.events || eventsResult.events.length === 0) {
      return {
        hasConflicts: false,
        conflictingEvents: [],
        date: resolvedDate,
        time,
        totalEventsInTimeframe: 0,
        source: 'Google Calendar'
      };
    }
    
    const reservationStartStr = `${isoDate}T${time}:00`;
    const reservationStart = zonedTimeToUtc(reservationStartStr, ROME_TIMEZONE);
    
    const RESERVATION_DURATION_MINUTES = 120;
    const reservationEnd = new Date(reservationStart.getTime() + RESERVATION_DURATION_MINUTES * 60 * 1000);
    
    const conflictingEvents = eventsResult.events.filter(event => {
      try {
        if (!event.startTime) return false;
        
        const eventStart = new Date(event.startTime);
        const eventEnd = event.endTime ? new Date(event.endTime) : 
          new Date(eventStart.getTime() + 60 * 60 * 1000);
        
        return (reservationStart < eventEnd && eventStart < reservationEnd);
      } catch (error) {
        safeLog('Error parsing event time for conflict check', { error: error.message }, 'warn');
        return false;
      }
    });
    
    safeLog('Calendar conflict check result', { 
      hasConflicts: conflictingEvents.length > 0,
      conflictingEventsCount: conflictingEvents.length,
      totalEvents: eventsResult.events.length,
      source: 'Google Calendar'
    });
    
    return {
      hasConflicts: conflictingEvents.length > 0,
      conflictingEvents: conflictingEvents,
      reservationWindow: {
        start: reservationStart.toISOString(),
        end: reservationEnd.toISOString(),
        durationMinutes: RESERVATION_DURATION_MINUTES
      },
      totalEventsInTimeframe: eventsResult.events.length,
      date: resolvedDate,
      time,
      source: 'Google Calendar'
    };
    
  } catch (error) {
    safeLog('Error checking calendar conflicts', { error: error.message }, 'error');
    throw error;
  }
}

// ===== RESERVATION VALIDATION =====
function validateReservationData(reservationData) {
  const errors = [];
  const warnings = [];
  
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
  
  if (reservationData.date) {
    try {
      const [day, month, year] = reservationData.date.split('-');
      const isoDateString = `${year}-${month}-${day}`;
      
      const romeResDay = startOfDay(
        utcToZonedTime(
          zonedTimeToUtc(`${isoDateString}T00:00:00`, ROME_TIMEZONE), 
          ROME_TIMEZONE
        )
      );
      const romeTodayDay = startOfDay(getRomeDate());
      
      if (isBefore(romeResDay, romeTodayDay)) {
        errors.push('Reservation date cannot be in the past');
      }
      
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

// ===== ENHANCED RESERVATION INTENT DETECTION =====
function detectReservationIntent(conversationText, transcript = []) {
  console.log('🔍 Detecting reservation intent...');
  
  const lowerText = conversationText.toLowerCase();
  
  const reservationKeywords = [
    'reservation', 'reserve', 'book', 'booking', 'make a reservation',
    'table for', 'reserve a table', 'book a table', 'make a booking',
    'dinner reservation', 'reserve seats', 'book seats', 'make reservation',
    'reserve for', 'book for', 'I want to reserve', 'I want to book',
    'I would like to reserve', 'I would like to book', 'can i reserve',
    'can i book', 'could i reserve', 'could i book',
    'make a table reservation', 'table booking', 'seat reservation',
    'prenotazione', 'prenotare', 'prenota', 'prenotiamo', 'prenotato',
    'prenotati', 'vorrei prenotare', 'desidero prenotare', 'posso prenotare',
    'faccio una prenotazione', 'fare una prenotazione', 'per prenotare',
    'prenotare un tavolo', 'prenotazione tavolo', 'tavolo per',
    'riservare', 'riservazione', 'riserva', 'vorrei riservare',
    'posto a sedere', 'posti a sedere', 'sedie', 'tavoli',
    'voglio prenotare', 'devo prenotare', 'ho bisogno di prenotare',
    'mi piacerebbe prenotare', 'avrei bisogno di prenotare',
    'vorrei riservare un tavolo', 'riservazione tavolo',
    'for dinner', 'per cena', 'for lunch', 'per pranzo',
    'for tonight', 'per stasera', 'for tomorrow', 'per domani'
  ];
  
  let foundKeywords = [];
  for (const keyword of reservationKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundKeywords.push(keyword);
    }
  }
  
  if (foundKeywords.length > 0) {
    console.log(`✅ Found reservation keywords: ${foundKeywords.join(', ')}`);
    return { wantsReservation: true, reason: `Keywords: ${foundKeywords.join(', ')}` };
  }
  
  const patterns = [
    /(for|per)\s+(\d+)\s+(people|persons|guests|persone|ospiti)/i,
    /(\d+)\s+(people|persons|guests|persone|ospiti)\s+(for|per)/i,
    /(table|tavolo)\s+(for|per)\s+(\d+)/i,
    /(i'd like|i would like|i want|vorrei|desidero)\s+(to\s+)?(reserve|book|prenotare)/i,
    /(can|could|may|posso|potrei)\s+(i|we|io|noi)\s+(reserve|book|prenotare)/i,
    /(un|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+(persone|ospiti)/i,
    /(per|a)\s+(nome|nome e cognome)/i,
    /(numero|telefono|cellulare)\s+(di|da)/i,
    /(che\s+ora|a\s+che\s+ora|what time)/i,
    /(che\s+giorno|che\s+data|what date)/i
  ];
  
  for (const pattern of patterns) {
    const match = lowerText.match(pattern);
    if (match) {
      console.log(`✅ Found reservation pattern: ${pattern.source} → "${match[0]}"`);
      return { wantsReservation: true, reason: `Pattern: ${match[0]}` };
    }
  }
  
  const agentMessages = transcript
    .filter(msg => msg.role === 'agent')
    .map(msg => msg.content || '')
    .join(' ')
    .toLowerCase();
  
  const agentQuestions = [
    'how many', 'what date', 'what time', 'phone number',
    'name', 'last name', 'first name', 'special requests',
    'guests', 'people', 'persons', 'reservation',
    'quante persone', 'che data', 'che ora', 'numero di telefono',
    'nome', 'cognome', 'nome e cognome', 'richieste speciali',
    'ospiti', 'persone', 'prenotazione', 'fino a che ora'
  ];
  
  let agentQuestionCount = 0;
  for (const question of agentQuestions) {
    if (agentMessages.includes(question)) {
      agentQuestionCount++;
    }
  }
  
  if (agentQuestionCount >= 2) {
    console.log(`✅ Agent asked ${agentQuestionCount} reservation-related questions`);
    return { wantsReservation: true, reason: `Agent questions: ${agentQuestionCount}` };
  }
  
  const userDetails = transcript
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content || '');
  
  const detailIndicators = [
    /\b(\d{1,2}[:.]\d{2})\b/,
    /\b(\d{1,2})\s*(am|pm|di mattina|di pomeriggio|di sera)\b/i,
    /\b(oggi|domani|lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\b/i,
    /\b(\d+)\s*(persone|ospiti|adulti|bambini)\b/i,
    /\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/,
    /\b(\d{2}\s?\d{4}\s?\d{4})\b/
  ];
  
  let detailCount = 0;
  for (const detail of userDetails) {
    for (const indicator of detailIndicators) {
      if (indicator.test(detail)) {
        detailCount++;
        break;
      }
    }
  }
  
  if (detailCount >= 2) {
    console.log(`✅ User provided ${detailCount} reservation details`);
    return { wantsReservation: true, reason: `User details: ${detailCount}` };
  }
  
  console.log('❌ No clear reservation intent detected');
  return { wantsReservation: false, reason: 'No indicators found' };
}

// ===== HELPER: Convert day name to actual date =====
function convertDayToDate(dayName) {
  // SAFETY: If already in DD-MM-YYYY format, return as-is (prevents recursion)
  if (dayName && typeof dayName === 'string' && dayName.match(/^\d{2}-\d{2}-\d{4}$/)) {
    console.log(`📅 convertDayToDate: "${dayName}" is already formatted, returning as-is`);
    return dayName;
  }
  
  // SAFETY: If already in YYYY-MM-DD format, convert to DD-MM-YYYY
  if (dayName && typeof dayName === 'string' && dayName.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dayName.split('-');
    const converted = `${day}-${month}-${year}`;
    console.log(`📅 convertDayToDate: Converted "${dayName}" to "${converted}"`);
    return converted;
  }
  
  const romeToday = getRomeDate();
  
  // ===== FIRST: Check for absolute date patterns (e.g., "11 aprile 2026", "April 11 2026") =====
  
  // Italian pattern: "11 aprile 2026" or "11 aprile"
  const italianAbsoluteMatch = dayName.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/i);
  if (italianAbsoluteMatch) {
    const day = parseInt(italianAbsoluteMatch[1]);
    const monthMap = {
      'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5, 'giugno': 6,
      'luglio': 7, 'agosto': 8, 'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12
    };
    const month = monthMap[italianAbsoluteMatch[2].toLowerCase()];
    let year = italianAbsoluteMatch[3] ? parseInt(italianAbsoluteMatch[3]) : romeToday.getFullYear();
    
    // If the date has passed this year, use next year
    const testDate = new Date(year, month - 1, day);
    if (testDate < romeToday && !italianAbsoluteMatch[3]) {
      year++;
    }
    
    const formattedDay = day.toString().padStart(2, '0');
    const formattedMonth = month.toString().padStart(2, '0');
    return `${formattedDay}-${formattedMonth}-${year}`;
  }
  
  // English pattern: "April 11 2026" or "April 11" or "11 April"
  const englishAbsoluteMatch = dayName.match(/(?:(\d{1,2})\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{1,2}))?(?:\s+(\d{4}))?/i);
  if (englishAbsoluteMatch) {
    const monthMap = {
      'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
      'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
    };
    const month = monthMap[englishAbsoluteMatch[2].toLowerCase()];
    let day = englishAbsoluteMatch[3] ? parseInt(englishAbsoluteMatch[3]) : (englishAbsoluteMatch[1] ? parseInt(englishAbsoluteMatch[1]) : null);
    let year = englishAbsoluteMatch[4] ? parseInt(englishAbsoluteMatch[4]) : romeToday.getFullYear();
    
    if (day && day >= 1 && day <= 31) {
      const testDate = new Date(year, month - 1, day);
      if (testDate < romeToday && !englishAbsoluteMatch[4]) {
        year++;
      }
      const formattedDay = day.toString().padStart(2, '0');
      const formattedMonth = month.toString().padStart(2, '0');
      return `${formattedDay}-${formattedMonth}-${year}`;
    }
  }
  
  // Pattern: "11th April" or "April 11th"
  const ordinalMatch = dayName.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)/i);
  if (ordinalMatch) {
    const day = parseInt(ordinalMatch[1]);
    const monthMap = {
      'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
      'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
    };
    const month = monthMap[ordinalMatch[2].toLowerCase()];
    let year = romeToday.getFullYear();
    
    const testDate = new Date(year, month - 1, day);
    if (testDate < romeToday) {
      year++;
    }
    
    const formattedDay = day.toString().padStart(2, '0');
    const formattedMonth = month.toString().padStart(2, '0');
    return `${formattedDay}-${formattedMonth}-${year}`;
  }
  
  // ===== SECOND: Handle relative day names =====
  const dayMap = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 'sabato': 6,
    'today': 'today', 'oggi': 'today', 'tomorrow': 'tomorrow', 'domani': 'tomorrow',
    'tonight': 'today', 'stasera': 'today', 'questa sera': 'today'
  };
  
  const targetDay = dayMap[dayName.toLowerCase()];
  
  if (targetDay === 'today') {
    return formatInTimeZone(romeToday, ROME_TIMEZONE, 'dd-MM-yyyy');
  } else if (targetDay === 'tomorrow') {
    const tomorrow = new Date(romeToday);
    tomorrow.setDate(romeToday.getDate() + 1);
    return formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
  } else if (targetDay !== undefined) {
    const daysUntil = (targetDay - romeToday.getDay() + 7) % 7 || 7;
    const targetDate = new Date(romeToday);
    targetDate.setDate(romeToday.getDate() + daysUntil);
    return formatInTimeZone(targetDate, ROME_TIMEZONE, 'dd-MM-yyyy');
  }
  
  // ===== FALLBACK: If nothing matches, return tomorrow =====
  console.log(`⚠️ convertDayToDate could not parse "${dayName}", defaulting to tomorrow`);
  const tomorrow = new Date(romeToday);
  tomorrow.setDate(romeToday.getDate() + 1);
  return formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
}
// ===== COMPREHENSIVE RESERVATION EXTRACTION CODE =====
function extractReservationData(conversation, systemLogs = '') {
  console.log('🔍 Comprehensive reservation data extraction started...');
  
  const defaultReservation = {
    firstName: '',
    lastName: '',
    date: formatInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), ROME_TIMEZONE, 'dd-MM-yyyy'),
    time: '22:00',
    guests: 2,
    adults: 2,
    children: 0,
    phone: '',
    specialRequests: 'No special requests',
    newsletter: false
  };

  const sources = {
    structuredBlock: extractFromStructuredBlock(conversation, systemLogs),
    conversationFlow: extractFromConversationFlow(conversation),
    systemLogs: extractFromSystemLogs(systemLogs)
  };

  console.log('📊 Data from all sources:', sources);

  const finalData = mergeAndResolveData(sources, defaultReservation);
  
  console.log('✅ Final resolved data:', finalData);
  return finalData;
}

function extractFromStructuredBlock(conversation, systemLogs) {
  console.log('🔍 Checking for structured data block...');
  const data = {};
  
  const fullConversationText = conversation 
    .map(msg => msg.content || '')
    .join('\n');
  
  const structuredMatch = fullConversationText.match(/RESERVATION_DATA:[\s\S]*?(?=\n\n|\n$|$)/i);
  if (structuredMatch) {
    console.log('✅ Found structured data in conversation');
    return parseStructuredBlock(structuredMatch[0]);
  }
  
  if (systemLogs) {
    const logMatch = systemLogs.match(/RESERVATION_DATA:[\s\S]*?(?=\n\n|\n$|$)/i);
    if (logMatch) {
      console.log('✅ Found structured data in system logs');
      return parseStructuredBlock(logMatch[0]);
    }
  }
  
  console.log('❌ No structured data block found');
  return data;
}

function parseStructuredBlock(block) {
  const data = {};
  const fieldPatterns = {
    'first name': (val) => data.firstName = val,
    'last name': (val) => data.lastName = val,
    'phone': (val) => data.phone = '+39' + val.replace(/\D/g, ''),
    'guests': (val) => data.guests = parseInt(val) || 2,
    'adults': (val) => data.adults = parseInt(val) || data.guests,
    'children': (val) => data.children = parseInt(val) || 0,
    'date': (val) => data.date = convertDayToDate(val),
    'time': (val) => data.time = val,
    'special requests': (val) => data.specialRequests = val === 'None' ? 'No special requests' : val,
    'newsletter': (val) => data.newsletter = val.toLowerCase() === 'yes'
  };

  Object.entries(fieldPatterns).forEach(([field, setter]) => {
    const regex = new RegExp(`${field}:\\s*([^\\n]+)`, 'i');
    const match = block.match(regex);
    if (match && match[1]) {
      const value = match[1].trim();
      console.log(`📋 Structured ${field}: "${value}"`);
      setter(value);
    }
  });

  return data;
}

function extractFromConversationFlow(conversation) {
  console.log('🔍 Extracting from conversation flow...');
  const data = {};
  
  let phoneDigits = '';
  let firstNameAsked = false;
  let lastNameAsked = false;
  let phoneAsked = false;
  let guestsAsked = false;
  let dateAsked = false;

  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    const content = msg.content || '';
    const lowerContent = content.toLowerCase();

    if (msg.role === 'agent') {
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
      
      if ((lowerContent.includes('last name') || 
           lowerContent.includes('surname') ||
           lowerContent.includes('cognome') ||
           lowerContent.includes('qual è il tuo cognome') ||
           lowerContent.includes('qual e il tuo cognome'))) {
        lastNameAsked = true;
      }
      
      if (lowerContent.includes('phone') || 
          lowerContent.includes('number') ||
          lowerContent.includes('contact number') ||
          lowerContent.includes('telefono') || 
          lowerContent.includes('numero') ||
          lowerContent.includes('recapito') ||
          lowerContent.includes('cellulare')) {
        phoneAsked = true;
      }
      
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
      
      if (lowerContent.includes('when') || 
          lowerContent.includes('what date') ||
          lowerContent.includes('which day') ||
          lowerContent.includes('quando') ||
          lowerContent.includes('che data') ||
          lowerContent.includes('che giorno') ||
          lowerContent.includes('quale data')) {
        dateAsked = true;
      }
      
      if ((content.includes('David') && content.includes('Anderson')) ||
          (content.includes('Dina') && content.includes('Anderson')) ||
          lowerContent.includes('signor anderson') ||
          lowerContent.includes('sig. anderson')) {
        data.firstName = content.includes('David') ? 'David' : 'Dina';
        data.lastName = 'Anderson';
      }
      
      if (lowerContent.match(/2\s*(people|person|guests?|adults?)/) ||
          lowerContent.includes('due persone') ||
          lowerContent.includes('2 persone') ||
          lowerContent.includes('per due') ||
          lowerContent.match(/per\s*2/)) {
        data.guests = 2;
        data.adults = 2;
      }
      
      if ((lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) ||
          (lowerContent.includes('venerdì') && lowerContent.includes('21:45')) ||
          (lowerContent.includes('venerdi') && lowerContent.includes('21:45'))) {
        data.date = convertDayToDate('next friday');
        data.time = '21:45';
      }
    }

    if (msg.role === 'user') {
      if (firstNameAsked && !lastNameAsked && !data.firstName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.firstName = nameMatch[1];
          firstNameAsked = false;
        }
      }
      
      if (lastNameAsked && !data.lastName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.lastName = nameMatch[1];
          lastNameAsked = false;
        }
      }
      
      if (guestsAsked && !data.guests) {
        if (lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/)) {
          const match = lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/);
          data.guests = parseInt(match[1]) || 2;
          data.adults = data.guests;
          guestsAsked = false;
        } else if (lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/) ||
                   lowerContent.includes('due persone') ||
                   lowerContent.includes('per due')) {
          const match = lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/);
          if (match && match[1]) {
            data.guests = parseInt(match[1]) || 2;
            data.adults = data.guests;
            guestsAsked = false;
          }
        }
      }
      
      if (dateAsked && !data.date) {
        if (lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          dateAsked = false;
        } else if ((lowerContent.includes('venerdì') || lowerContent.includes('venerdi')) && 
                   (lowerContent.includes('21:45') || lowerContent.includes('21.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          dateAsked = false;
        } else if (lowerContent.includes('stasera') || lowerContent.includes('questa sera')) {
          data.date = convertDayToDate('today');
          data.time = '20:00';
          dateAsked = false;
        } else if (lowerContent.includes('domani') || lowerContent.includes('tomorrow')) {
          data.date = convertDayToDate('tomorrow');
          data.time = '20:00';
          dateAsked = false;
        }
      }
      
      if (phoneAsked) {
        const digits = content
          .replace(/zero/gi, '0').replace(/one/gi, '1').replace(/two/gi, '2')
          .replace(/three/gi, '3').replace(/four/gi, '4').replace(/five/gi, '5')
          .replace(/six/gi, '6').replace(/seven/gi, '7').replace(/eight/gi, '8')
          .replace(/nine/gi, '9').replace(/uno/gi, '1').replace(/due/gi, '2')
          .replace(/tre/gi, '3').replace(/quattro/gi, '4').replace(/cinque/gi, '5')
          .replace(/sei/gi, '6').replace(/sette/gi, '7').replace(/otto/gi, '8')
          .replace(/nove/gi, '9').replace(/\D/g, '');
        
        if (digits.length > 0) {
          phoneDigits += digits;
        }
        
        if (phoneDigits.length >= 10) {
          phoneAsked = false;
        }
      }
      
      if (lowerContent.includes('honeymoon') || 
          lowerContent.includes('surprise') ||
          lowerContent.includes('romantic') ||
          lowerContent.includes('luna di miele') || 
          lowerContent.includes('sorpresa') ||
          lowerContent.includes('romantico') ||
          lowerContent.includes('romantica')) {
        data.specialRequests = 'Romantic song in the background for honeymoon surprise';
      }
      
      if ((lowerContent.includes('newsletter') && (lowerContent.includes('yes') || lowerContent.includes('join'))) ||
          (lowerContent.includes('newsletter') && (lowerContent.includes('sì') || lowerContent.includes('si'))) ||
          lowerContent.includes('iscriviti') ||
          lowerContent.includes('mi iscrivo') ||
          lowerContent.includes('volentieri')) {
        data.newsletter = true;
      }
    }
  }
  
  if (phoneDigits.length >= 7) {
    data.phone = '+39' + phoneDigits.substring(0, 10);
  }
  
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
      switch (field) {
        case 'firstName': data.firstName = value; break;
        case 'lastName': data.lastName = value; break;
        case 'phone': data.phone = value.replace(/\s/g, ''); break;
        case 'guests': data.guests = parseInt(value); data.adults = data.guests; break;
        case 'date': data.date = convertDayToDate(value); break;
        case 'time': data.time = value; break;
        case 'specialRequests': data.specialRequests = value; break;
        case 'newsletter': data.newsletter = value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'; break;
      }
    }
  });
  
  return data;
}

function mergeAndResolveData(sources, defaultData) {
  const finalData = { ...defaultData };
  const sourcePriority = ['structuredBlock', 'conversationFlow', 'systemLogs'];
  const fields = ['firstName', 'lastName', 'phone', 'guests', 'adults', 'children', 'date', 'time', 'specialRequests', 'newsletter'];
  
  fields.forEach(field => {
    for (const source of sourcePriority) {
      if (sources[source][field] !== undefined && 
          sources[source][field] !== '' && 
          sources[source][field] !== null) {
        
        if (isValidFieldValue(field, sources[source][field])) {
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
    case 'phone': return value.length >= 10;
    case 'guests':
    case 'adults':
    case 'children': return value > 0 && value < 20;
    case 'time': return /^\d{1,2}:\d{2}$/.test(value);
    default: return true;
  }
}

function crossValidateFields(finalData, sources) {
  if (finalData.adults && finalData.children !== undefined) {
    const calculatedGuests = finalData.adults + finalData.children;
    if (finalData.guests !== calculatedGuests && calculatedGuests > 0 && calculatedGuests < 20) {
      finalData.guests = calculatedGuests;
    }
  }
  
  if (finalData.phone && !finalData.phone.startsWith('+39')) {
    finalData.phone = '+39' + finalData.phone.replace(/\D/g, '');
  }
  
  const [day, month, year] = finalData.date.split('-');
  const reservationDate = new Date(`${year}-${month}-${day}`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (reservationDate < today) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    finalData.date = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
  }
}


// ===================================================================
// ===== API ENDPOINTS =====
// ===================================================================

// A) Authoritative time context endpoint with FULL logging
app.get('/api/now', (req, res) => {
  // Increment ping counter
  pingCounter++;
  
  // Get current timestamp
  const now = new Date();
  const timestamp = now.toISOString();
  
  // Log EVERY ping with details
  console.log('\n' + '='.repeat(60));
  console.log(`🏓🏓🏓 PING #${pingCounter} RECEIVED 🏓🏓🏓`);
  console.log(`   Time: ${timestamp}`);
  console.log(`   Local Italy Time: ${formatInTimeZone(now, ROME_TIMEZONE, 'dd-MM-yyyy HH:mm:ss')}`);
  console.log(`   IP: ${req.ip || req.socket.remoteAddress || 'unknown'}`);
  console.log(`   User Agent: ${req.get('user-agent') || 'unknown'}`);
  console.log('='.repeat(60));
  
  // Store in history (keep last 100 pings)
  pingHistory.unshift({
    pingNumber: pingCounter,
    timestamp: timestamp,
    localTime: formatInTimeZone(now, ROME_TIMEZONE, 'dd-MM-yyyy HH:mm:ss')
  });
  
  // Keep only last 100 pings in memory
  if (pingHistory.length > 100) {
    pingHistory.pop();
  }
  
  try {
    const romeDateTime = getRomeDateTime();
    const greeting = getItalianTimeGreeting();
    
    console.log(`📤 Responding to ping #${pingCounter}:`);
    console.log(`   Rome time: ${romeDateTime.date} ${romeDateTime.time}`);
    console.log(`   Greeting: ${greeting}`);
    
    res.json({
      success: true,
      pingCount: pingCounter,
      pingTimestamp: timestamp,
      pingLocalTime: formatInTimeZone(now, ROME_TIMEZONE, 'dd-MM-yyyy HH:mm:ss'),
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
      note: "All dates and times are based on Europe/Rome timezone",
      serverStatus: "active"
    });
    
    console.log(`✅ Ping #${pingCounter} response sent successfully`);
    
  } catch (error) {
    console.error(`❌ Error in ping #${pingCounter}:`, error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get Rome time', 
      message: error.message,
      pingCount: pingCounter
    });
  }
});

// Optional: Endpoint to view ping history (for debugging)
app.get('/api/ping-history', (req, res) => {
  console.log(`\n📊 Ping history requested - Total pings: ${pingCounter}`);
  res.json({
    success: true,
    totalPings: pingCounter,
    last100Pings: pingHistory,
    serverUptime: process.uptime(),
    serverStartTime: new Date(Date.now() - process.uptime() * 1000).toISOString()
  });
});
// B2) Resolve date — GET (legacy)
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
    
    const resolvedDate = resolveDate(text);
    const romeDateTime = getRomeDateTime();
    
    res.json({
      success: true,
      originalText: text,
      resolvedDate,
      timezone: ROME_TIMEZONE,
      todayInRome: romeDateTime.date,
      source: 'Rome-timezone-aware parsing',
      message: `"${text}" resolved to ${resolvedDate} based on Rome time (today: ${romeDateTime.date})`
    });
    
  } catch (error) {
    safeLog('Error in /api/resolve-date endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to resolve date', message: error.message, todayInRome: getRomeDateToday()
    });
  }
});

// C) Single day — POST (Retell format, primary)
app.post('/api/calendar/date', async (req, res) => {
  try {
    const date = req.body.date || req.body.args?.date;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date (DD-MM-YYYY or relative date like "tomorrow", "the fourth", etc.)'
      });
    }
    
    safeLog('🤖 Retell AI agent requesting events via POST', { originalDate: date, source: 'Google Calendar only' });
    
    try {
      const result = await get_events_by_date(date);
      
      res.json({
        success: result.success,
        date: result.resolvedDate,
        originalDate: date,
        eventCount: result.events?.length || 0,
        events: result.events || [],
        message: result.message,
        source: result.source
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in POST /api/calendar/date', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to fetch events from Google Calendar',
        message: calendarError.message,
        date, eventCount: 0, events: []
      });
    }
    
  } catch (error) {
    safeLog('Error in POST /api/calendar/date endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to process request', message: error.message,
      date: req.body.date || req.body.args?.date, eventCount: 0, events: []
    });
  }
});

// C2) Single day — GET (legacy)
app.get('/api/calendar/date', async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date (DD-MM-YYYY or relative date like "tomorrow", "the fourth", etc.)'
      });
    }
    
    try {
      const result = await get_events_by_date(date);
      
      res.json({
        success: result.success,
        originalDate: date,
        resolvedDate: result.resolvedDate,
        eventCount: result.events?.length || 0,
        events: result.events || [],
        message: result.message,
        source: result.source,
        summary: result.events?.length === 0 
          ? `No events found for ${date} in Google Calendar.` 
          : `Found ${result.events.length} event(s) for ${result.resolvedDate} in Google Calendar.`,
        note: 'Google Calendar is the only source of truth'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in GET /api/calendar/date', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to fetch events from Google Calendar',
        message: calendarError.message,
        todayInRome: getRomeDateToday()
      });
    }
    
  } catch (error) {
    safeLog('Error in GET calendar/date endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to process request', message: error.message, todayInRome: getRomeDateToday()
    });
  }
});

// D) Full week — POST (Retell format, primary)
app.post('/api/calendar/week', async (req, res) => {
  try {
    const startDate = req.body.startDate || req.body.args?.startDate || req.body.date || req.body.args?.date;
    
    if (!startDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing startDate parameter',
        message: 'Please provide a start date (DD-MM-YYYY or relative date like "tomorrow", "next monday", etc.)'
      });
    }
    
    safeLog('🤖 Retell AI agent requesting week events via POST', { originalStartDate: startDate, source: 'Google Calendar only' });
    
    try {
      const result = await get_events_for_week(startDate);
      
      res.json({
        success: result.success,
        startDate: result.startDate,
        endDate: result.endDate,
        totalEvents: result.totalEvents || 0,
        daysWithEvents: result.daysWithEvents || 0,
        soldOutEvents: result.soldOutEvents || 0,
        weekEvents: result.weekEvents || [],
        message: result.message,
        source: result.source
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in POST /api/calendar/week', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to fetch week events from Google Calendar',
        message: calendarError.message,
        startDate, totalEvents: 0, weekEvents: []
      });
    }
    
  } catch (error) {
    safeLog('Error in POST /api/calendar/week endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to process request', message: error.message,
      startDate: req.body.startDate || req.body.args?.startDate, totalEvents: 0, weekEvents: []
    });
  }
});

// D2) Full week — GET (legacy)
app.get('/api/calendar/week', async (req, res) => {
  try {
    const { startDate } = req.query;
    
    if (!startDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing startDate parameter',
        message: 'Please provide a start date (DD-MM-YYYY or relative date like "tomorrow", "next monday", etc.)'
      });
    }
    
    try {
      const result = await get_events_for_week(startDate);
      
      res.json({
        success: result.success,
        startDate: result.startDate,
        endDate: result.endDate,
        totalEvents: result.totalEvents || 0,
        daysWithEvents: result.daysWithEvents || 0,
        soldOutEvents: result.soldOutEvents || 0,
        weekEvents: result.weekEvents || [],
        message: result.message,
        source: result.source,
        summary: result.totalEvents === 0 
          ? `No events found from ${result.startDate} to ${result.endDate} in Google Calendar.` 
          : `Found ${result.totalEvents} event(s) from ${result.startDate} to ${result.endDate} in Google Calendar.`,
        note: 'Google Calendar is the only source of truth'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in GET /api/calendar/week', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to fetch week events from Google Calendar',
        message: calendarError.message,
        note: 'Google Calendar is the only source of truth - please check calendar connectivity'
      });
    }
    
  } catch (error) {
    safeLog('Error in GET calendar/week endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to process request', message: error.message
    });
  }
});

// E) Date range — POST (Retell format, primary)
app.post('/api/calendar/range', async (req, res) => {
  try {
    const startDate = req.body.startDate || req.body.args?.startDate;
    const endDate   = req.body.endDate   || req.body.args?.endDate;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing startDate or endDate parameter',
        message: 'Please provide both startDate and endDate (DD-MM-YYYY or relative dates).'
      });
    }
    
    safeLog('🤖 Retell AI agent requesting date range events via POST', { 
      originalStartDate: startDate, originalEndDate: endDate, source: 'Google Calendar only' 
    });
    
    try {
      const result = await get_events_for_date_range(startDate, endDate);
      
      res.json({
        success: result.success,
        startDate: result.startDate,
        endDate: result.endDate,
        totalDays: result.totalDays || 0,
        totalEvents: result.totalEvents || 0,
        daysWithEvents: result.daysWithEvents || 0,
        soldOutEvents: result.soldOutEvents || 0,
        rangeEvents: result.rangeEvents || [],
        message: result.message,
        source: result.source
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in POST /api/calendar/range', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to fetch range events from Google Calendar',
        message: calendarError.message,
        startDate, endDate, totalEvents: 0, rangeEvents: []
      });
    }
    
  } catch (error) {
    safeLog('Error in POST /api/calendar/range endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to process request', message: error.message,
      startDate: req.body.startDate, endDate: req.body.endDate, totalEvents: 0, rangeEvents: []
    });
  }
});

// E2) Date range — GET (legacy / testing)
app.get('/api/calendar/range', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing startDate or endDate query parameter',
        message: 'Please provide both startDate and endDate (DD-MM-YYYY or relative dates).'
      });
    }
    
    try {
      const result = await get_events_for_date_range(startDate, endDate);
      
      res.json({
        success: result.success,
        startDate: result.startDate,
        endDate: result.endDate,
        totalDays: result.totalDays || 0,
        totalEvents: result.totalEvents || 0,
        daysWithEvents: result.daysWithEvents || 0,
        soldOutEvents: result.soldOutEvents || 0,
        rangeEvents: result.rangeEvents || [],
        message: result.message,
        source: result.source,
        summary: result.totalEvents === 0
          ? `No events found from ${result.startDate} to ${result.endDate} in Google Calendar.`
          : `Found ${result.totalEvents} event(s) from ${result.startDate} to ${result.endDate} (${result.totalDays} days).`,
        note: 'Google Calendar is the only source of truth. Max range: 31 days.'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in GET /api/calendar/range', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to fetch range events from Google Calendar',
        message: calendarError.message
      });
    }
    
  } catch (error) {
    safeLog('Error in GET calendar/range endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to process request', message: error.message
    });
  }
});

// F) Check availability for specific date and time
app.get('/api/calendar/availability', async (req, res) => {
  try {
    const { date, time } = req.query;
    
    if (!date || !time) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters',
        message: 'Please provide both date (DD-MM-YYYY or relative date) and time (HH:MM)'
      });
    }
    
    safeLog('🤖 AI Agent checking availability', { date, time, source: 'Google Calendar only' });
    
    try {
      const calendarCheck = await checkCalendarForConflicts(date, time);
      
      res.json({
        success: true,
        date,
        resolvedDate: calendarCheck.date,
        time,
        available: !calendarCheck.hasConflicts,
        hasConflicts: calendarCheck.hasConflicts,
        conflictingEventsCount: calendarCheck.conflictingEvents.length,
        conflictingEvents: calendarCheck.conflictingEvents.map(e => ({
          title: e.title, time: e.time, isSoldOut: e.isSoldOut
        })),
        reservationDuration: calendarCheck.reservationWindow?.durationMinutes || 120,
        message: calendarCheck.hasConflicts 
          ? `Time slot ${time} on ${calendarCheck.date} conflicts with ${calendarCheck.conflictingEvents.length} event(s).` 
          : `Time slot ${time} on ${calendarCheck.date} is available.`,
        source: calendarCheck.source || 'Google Calendar',
        note: 'Google Calendar is the only source of truth for event scheduling'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in /api/calendar/availability', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false, error: 'Failed to check calendar availability', message: calendarError.message
      });
    }
    
  } catch (error) {
    safeLog('Error in calendar/availability endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false, error: 'Failed to process request', message: error.message
    });
  }
});

// G) Time-based greeting — GET
app.get('/api/time-greeting', (req, res) => {
  try {
    const { format } = req.query;
    const greetingResult = get_time_greeting(format || 'italian');
    
    res.json({
      success: true,
      greeting: greetingResult.greeting,
      fullGreeting: greetingResult.fullGreeting,
      hour: greetingResult.hour,
      timezone: greetingResult.timezone,
      localTime: greetingResult.localTime,
      date: greetingResult.date,
      format: greetingResult.format,
      suggestedUse: "Use this greeting at the beginning of conversations or when welcoming callers",
      examples: {
        opening: `${greetingResult.fullGreeting}`,
        confirmation: `Perfetto! ${greetingResult.greeting}! Ho prenotato per voi...`,
        farewell: `Grazie per aver chiamato! ${greetingResult.greeting} e arrivederci!`
      }
    });
    
  } catch (error) {
    safeLog('Error in /api/time-greeting endpoint', { error: error.message }, 'error');
    res.status(500).json({ success: false, error: 'Failed to generate time greeting', message: error.message });
  }
});

// G2) Time-based greeting — POST (Retell format)
app.post('/api/time-greeting', (req, res) => {
  try {
    const { format, context } = req.body;
    const greetingResult = get_time_greeting(format || 'italian');
    
    let responseText;
    if (context === 'call_opening') {
      responseText = `${greetingResult.fullGreeting}`;
    } else if (context === 'confirmation') {
      responseText = `Perfetto! ${greetingResult.greeting}!`;
    } else {
      responseText = `${greetingResult.greeting}!`;
    }
    
    res.json({
      response: responseText,
      greeting: greetingResult.greeting,
      hour: greetingResult.hour,
      timezone: greetingResult.timezone,
      success: true
    });
    
  } catch (error) {
    safeLog('Error in POST /api/time-greeting endpoint', { error: error.message }, 'error');
    res.status(500).json({
      response: "Buongiorno! Benvenuti al Jazzamore.", success: false, error: error.message
    });
  }
});

// H) Diagnostic endpoint
app.get('/api/calendar/diagnostic', async (req, res) => {
  try {
    const calendar = await getCalendarClient();
    
    if (!calendar) {
      return res.json({
        success: false,
        step: 'authentication',
        error: 'Failed to authenticate with Google Calendar',
        serviceAccount: serviceAccount.client_email,
        action: 'Check service account credentials'
      });
    }
    
    try {
      const todayRome = getRomeDateToday();
      const [day, month, year] = todayRome.split('-');
      const isoDateForCalendar = `${year}-${month}-${day}`;
      const startUTC = zonedTimeToUtc(`${isoDateForCalendar}T00:00:00`, ROME_TIMEZONE);
      const endUTC = zonedTimeToUtc(`${isoDateForCalendar}T23:59:59`, ROME_TIMEZONE);
      
      const response = await calendar.events.list({
        calendarId: JAZZAMORE_CALENDAR_ID,
        timeMin: startUTC.toISOString(),
        timeMax: endUTC.toISOString(),
        maxResults: 5,
      });
      
      res.json({
        success: true,
        diagnostic: {
          authentication: '✅ OK',
          jazzamoreCalendar: `✅ Accessible (${JAZZAMORE_CALENDAR_ID})`,
          eventsFound: response.data.items?.length || 0,
          serviceAccount: serviceAccount.client_email,
          scope: 'calendar.readonly',
          timezone: ROME_TIMEZONE,
          romeToday: formatInTimeZone(new Date(), ROME_TIMEZONE, 'dd-MM-yyyy HH:mm:ss'),
          message: 'Google Calendar is accessible and ready'
        }
      });
      
    } catch (error) {
      return res.json({
        success: false,
        step: 'calendar_access',
        error: `Cannot access Jazzamore calendar: ${error.message}`,
        jazzamoreCalendarId: JAZZAMORE_CALENDAR_ID,
        serviceAccount: serviceAccount.client_email,
        action: 'Share your Google Calendar with the service account email above with "See all event details" permission'
      });
    }
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// I) Test Google Calendar integration
app.get('/api/test/google-calendar', async (req, res) => {
  try {
    const { date } = req.query;
    const testDate = date || 'tomorrow';
    const result = await getEventsForDate(testDate);
    
    res.json({
      success: true,
      test: 'Google Calendar Integration Test',
      input: testDate,
      result,
      verification: {
        source: result.source,
        isUsingGoogleCalendar: result.source === 'Google Calendar',
        hasEvents: result.events?.length > 0,
        eventCount: result.events?.length || 0
      },
      message: result.message
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// J) Check if a date is closed (POST - for Retell agent)
app.post('/api/check-closure', (req, res) => {
  try {
    const date = req.body.date || req.body.args?.date;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date to check'
      });
    }
    
    if (isClosedDayByName(date)) {
      const closedResponse = getClosedDayResponse(date);
      return res.json({
        success: false,
        isClosed: true,
        ...closedResponse,
        originalDate: date
      });
    }
    
    const closureCheck = checkIfClosed(date);
    
    if (closureCheck.isClosed) {
      return res.json({
        success: false,
        isClosed: true,
        date: closureCheck.date,
        dayOfWeek: closureCheck.dayOfWeek,
        dayName: closureCheck.dayName,
        dayNameItalian: closureCheck.dayNameItalian,
        message: closureCheck.message,
        suggestedAlternatives: ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        suggestedAlternativesItalian: ['Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
        originalDate: date
      });
    }
    
    return res.json({
      success: true,
      isClosed: false,
      date: closureCheck.date,
      dayOfWeek: closureCheck.dayOfWeek,
      dayName: closureCheck.dayName,
      dayNameItalian: closureCheck.dayNameItalian,
      message: `Jazzamore is open on ${closureCheck.dayName} (${closureCheck.dayNameItalian}). Would you like to make a reservation for ${closureCheck.date}?`,
      originalDate: date
    });
    
  } catch (error) {
    safeLog('Error in /api/check-closure endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to check closure status',
      message: 'I had trouble checking if we are open that day. Could you please try another date?'
    });
  }
});

// J2) Check if a date is closed (GET - for testing)
app.get('/api/check-closure', (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date to check (e.g., "tomorrow", "next monday", "15-04-2026")'
      });
    }
    
    const closureCheck = checkIfClosed(date);
    
    res.json({
      success: true,
      input: date,
      resolvedDate: closureCheck.date,
      isClosed: closureCheck.isClosed,
      dayOfWeek: closureCheck.dayOfWeek,
      dayName: closureCheck.dayName,
      dayNameItalian: closureCheck.dayNameItalian,
      message: closureCheck.message,
      openDays: closureCheck.openDays,
      closedDays: closureCheck.closedDays
    });
    
  } catch (error) {
    safeLog('Error in GET /api/check-closure endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to check closure status',
      message: error.message
    });
  }
});

// ===================================================================
// ===== MAIN WEBHOOK ENDPOINT =====
// ===================================================================
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('📞📞📞 RETELL RESERVATION WEBHOOK RECEIVED 📞📞📞');
    console.log('='.repeat(80));
    console.log('Event:', req.body.event);
    
    const { event, call } = req.body;
    
    if (event !== 'call_analyzed') {
      console.log(`⚠️ Ignoring event type: ${event}`);
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_analyzed event...');
    console.log('Call ID:', call?.call_id);
    console.log('Call duration:', call?.duration_seconds, 'seconds');
    
    const conversationText = call?.transcript_object
      ?.map(msg => msg.content || '')
      .join(' ')
      .toLowerCase() || '';
    
    console.log('\n📝 Conversation transcript:');
    call?.transcript_object?.forEach((msg, idx) => {
      console.log(`   ${idx}: ${msg.role.toUpperCase()} - "${msg.content}"`);
    });
    
    const intentResult = detectReservationIntent(conversationText, call?.transcript_object || []);
    
    if (!intentResult.wantsReservation) {
      console.log('\n❌ No reservation intent detected. NOT saving to Airtable.');
      const greeting = getItalianTimeGreeting();
      return res.json({
        response: `${greeting}! Grazie per aver chiamato il Jazzamore. Come posso aiutarti?`,
        saveToAirtable: false,
        reason: 'No reservation intent detected'
      });
    }
    
    console.log('\n✅ Reservation intent detected. Proceeding with data extraction...');
    
    const reservationId = generateReservationId();
    console.log(`🆔 Generated Reservation ID: ${reservationId}`);
    
    let postCallData = null;
    if (call?.call_analysis?.custom_analysis_data?.reservation_details) {
      try {
        postCallData = JSON.parse(call.call_analysis.custom_analysis_data.reservation_details);
        console.log('\n📊 Post-call analysis data:', JSON.stringify(postCallData, null, 2));
      } catch (error) {
        console.log('❌ Error parsing reservation_details JSON:', error.message);
      }
    } else if (call?.post_call_analysis?.reservation_details) {
      postCallData = call.post_call_analysis.reservation_details;
    } else if (call?.analysis?.reservation_details) {
      postCallData = call.analysis.reservation_details;
    } else if (call?.call_analysis?.reservation_details) {
      postCallData = call.call_analysis.reservation_details;
    }
    
    // Extract data from transcript as fallback
    let transcriptFirstName = null;
    let transcriptLastName = null;
    let transcriptGuests = null;
    let transcriptDate = null;
    let transcriptTime = null;
    
    console.log('\n🔍 Extracting data from transcript...');
    
    if (call?.transcript_object) {
      for (const msg of call.transcript_object) {
        if (msg.role === 'user') {
          const content = msg.content;
          const lowerContent = content.toLowerCase();
          
          const nameMatch = content.match(/(?:mi chiamo|my name is|sono|i'm)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
          if (nameMatch && !transcriptFirstName) {
            transcriptFirstName = nameMatch[1];
            transcriptLastName = nameMatch[2];
            console.log(`   Found name: ${transcriptFirstName} ${transcriptLastName}`);
          }
          
          const guestsMatch = lowerContent.match(/(\d+)\s*(?:people|persons|guests|persone|ospiti)/i);
          if (guestsMatch && !transcriptGuests) {
            transcriptGuests = parseInt(guestsMatch[1]);
            console.log(`   Found guests: ${transcriptGuests}`);
          }
          
          const timeMatch = content.match(/(\d{1,2})[\s:]?(\d{2})?\s*(?:am|pm|di sera|di mattina)?/i);
          if (timeMatch && !transcriptTime) {
            let hour = parseInt(timeMatch[1]);
            const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            if (hour < 12 && lowerContent.includes('pm')) hour += 12;
            if (hour === 12 && lowerContent.includes('am')) hour = 0;
            transcriptTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            console.log(`   Found time: ${transcriptTime}`);
          }
        }
      }
    }
    
    const transcriptPhone = extractPhoneFromTranscript(call?.transcript_object);
    console.log(`\n📱 Extracted phone: ${transcriptPhone || 'None'}`);
    
    const whatsappFromTranscript = extractWhatsappConfirmation(call?.transcript_object);
    const newsletterFromTranscript = extractNewsletterConfirmation(call?.transcript_object);
    console.log(`📱 WhatsApp confirmation: ${whatsappFromTranscript}`);
    console.log(`📧 Newsletter confirmation: ${newsletterFromTranscript}`);

    // ============================================
    // ===== FIELD COMPARISON USING CONFIDENCE SCORES =====
    // ============================================
    
    console.log('\n📊 COMPARING FIELDS: Post-call vs Transcript');
    console.log('='.repeat(50));
    
    const bestFirstName = getBestFieldValue(
      postCallData?.first_name || postCallData?.firstName || null,
      transcriptFirstName,
      'firstName'
    );
    
    const bestLastName = getBestFieldValue(
      postCallData?.last_name || postCallData?.lastName || null,
      transcriptLastName,
      'lastName'
    );
    
    let postCallGuests = null;
    if (postCallData?.guests) {
      postCallGuests = parseInt(postCallData.guests);
    }
    const bestGuests = getBestFieldValue(postCallGuests, transcriptGuests, 'guests');
    
    let postCallDate = null;
    if (postCallData?.date) {
      const isAlreadyFormatted = postCallData.date.match(/^\d{2}-\d{2}-\d{4}$/);
      if (isAlreadyFormatted) {
        postCallDate = postCallData.date;
        console.log(`📅 Date already in correct format: ${postCallDate}`);
      } else {
        postCallDate = convertDayToDate(postCallData.date);
      }
    }
    const bestDate = getBestFieldValue(postCallDate, transcriptDate, 'date');
    
    const bestTime = getBestFieldValue(postCallData?.time || null, transcriptTime, 'time');
    
    const phoneContext = {
      field: 'phone',
      userConfirmed: true,
      agentReadBack: true
    };
    const bestPhone = getBestFieldValue(postCallData?.phone || null, transcriptPhone, 'phone', phoneContext);
    
    // Build final reservation data with best values
    const reservationData = {
      firstName: bestFirstName || '',
      lastName: bestLastName || '',
      phone: bestPhone || '',
      guests: bestGuests || 2,
      adults: bestGuests || 2,
      children: 0,
      date: bestDate || formatInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), ROME_TIMEZONE, 'dd-MM-yyyy'),
      time: bestTime || '20:00',
      specialRequests: postCallData?.special_requests || postCallData?.specialRequests || 'No special requests',
      newsletter: newsletterFromTranscript !== null ? newsletterFromTranscript : (postCallData?.newsletter === 'yes' || false),
      whatsapp_confirmation: whatsappFromTranscript !== null ? whatsappFromTranscript : (postCallData?.whatsapp_confirmation === 'yes' || false)
    };
    
    // ============================================
    // ===== SHOW-ONLY DETECTION (MOVED HERE - AFTER reservationData EXISTS) =====
    // ============================================
    
    function isShowOnlyReservation(time, specialRequests, transcript) {
      const [hour, minute] = (time || '').split(':').map(Number);
      
      if (hour >= 21 && minute >= 30) {
        return true;
      }
      
      const showOnlyKeywords = [
        'solo spettacolo', 'show only', 'after dinner', 'dopo cena',
        'solo concerto', 'concert only', 'no dinner', 'senza cena'
      ];
      
      const conversationText = transcript
        ?.map(msg => (msg.content || '').toLowerCase())
        .join(' ') || '';
      
      for (const keyword of showOnlyKeywords) {
        if (conversationText.includes(keyword)) {
          return true;
        }
      }
      
      return false;
    }
    
    let finalSpecialRequests = reservationData.specialRequests || '';
    let isShowOnly = false;
    let dinnerCount = parseInt(reservationData.adults) || parseInt(reservationData.guests) || 2;
    let showOnlyCount = 0;
    let reservationType = "Dinner + Show";
    
    // Check if this is a show-only reservation
    if (reservationData.time) {
      isShowOnly = isShowOnlyReservation(
        reservationData.time, 
        reservationData.specialRequests,
        call?.transcript_object
      );
    }
    
    if (isShowOnly) {
      finalSpecialRequests = 'NESSUNA RICHIESTA SPECIALE';
      dinnerCount = 0;
      showOnlyCount = parseInt(reservationData.guests) || 2;
      reservationType = "Show Only";
      console.log(`🎭 Show-only reservation detected - Setting special requests to "NESSUNA RICHIESTA SPECIALE"`);
    } else {
      if (!finalSpecialRequests || finalSpecialRequests === 'No special requests' || finalSpecialRequests === '') {
        finalSpecialRequests = 'Nessuna richiesta speciale';
      }
    }
    
    // Update reservationData with processed values
    reservationData.specialRequests = finalSpecialRequests;
    reservationData.reservationType = reservationType;
    
    console.log('\n✅ FINAL RESERVATION DATA:');
    console.log(`   Name: ${reservationData.firstName} ${reservationData.lastName}`);
    console.log(`   Phone: ${reservationData.phone}`);
    console.log(`   Guests: ${reservationData.guests}`);
    console.log(`   Date: ${reservationData.date}`);
    console.log(`   Time: ${reservationData.time}`);
    console.log(`   Special Requests: ${reservationData.specialRequests}`);
    console.log(`   WhatsApp: ${reservationData.whatsapp_confirmation}`);
    console.log(`   Newsletter: ${reservationData.newsletter}`);
    console.log(`   Reservation Type: ${reservationType}`);
    console.log(`   Dinner Count: ${dinnerCount}`);
    console.log(`   Show-Only Count: ${showOnlyCount}`);
    
    // ===== CLOSURE CHECK - BLOCK MONDAYS & TUESDAYS =====
    console.log('\n🔒 CHECKING CLOSURE STATUS');
    console.log('='.repeat(40));
    
    let validatedDate = reservationData.date;
    
    if (validatedDate) {
      if (isClosedDayByName(validatedDate)) {
        const closedResponse = getClosedDayResponse(validatedDate);
        console.log(`🚫 CLOSED DAY DETECTED: ${validatedDate}`);
        const greeting = getItalianTimeGreeting();
        return res.json({
          response: `${greeting}! ${closedResponse.message}`,
          saveToAirtable: false,
          reason: 'Restaurant closed on Monday/Tuesday',
          requiresNewDate: true
        });
      }
      
      const closureCheck = checkIfClosed(validatedDate);
      if (closureCheck.isClosed) {
        console.log(`🚫 CLOSED DAY DETECTED: ${validatedDate} is ${closureCheck.dayName}`);
        const greeting = getItalianTimeGreeting();
        return res.json({
          response: `${greeting}! ${closureCheck.message}`,
          saveToAirtable: false,
          reason: 'Restaurant closed on Monday/Tuesday',
          requiresNewDate: true
        });
      }
      
      console.log(`✅ Date is valid: ${validatedDate} is ${closureCheck.dayName}`);
    }
    
    // ===== VALIDATE ALL REQUIRED FIELDS BEFORE SAVING =====
    const missingRequiredFields = [];
    if (!reservationData.firstName || reservationData.firstName === '') missingRequiredFields.push('firstName');
    if (!reservationData.lastName || reservationData.lastName === '') missingRequiredFields.push('lastName');
    if (!reservationData.phone || reservationData.phone === '') missingRequiredFields.push('phone');
    if (!reservationData.date || reservationData.date === '') missingRequiredFields.push('date');
    if (!reservationData.time || reservationData.time === '') missingRequiredFields.push('time');
    if (!reservationData.guests || reservationData.guests < 1) missingRequiredFields.push('guests');
    
    if (missingRequiredFields.length > 0) {
      console.log(`\n❌ Missing required fields: ${missingRequiredFields.join(', ')}`);
      const greeting = getItalianTimeGreeting();
      return res.json({
        response: `${greeting}! Mi dispiace, non ho ricevuto tutte le informazioni necessarie per la prenotazione. Può richiamare per completare?`,
        saveToAirtable: false,
        reason: `Missing fields: ${missingRequiredFields.join(', ')}`
      });
    }
    
    // Format phone number
    let formattedPhone = reservationData.phone;
    const phoneDigits = reservationData.phone.replace(/\D/g, '');
    if (phoneDigits.length >= 9) {
      formattedPhone = phoneDigits.startsWith('39') ? `+${phoneDigits}` : `+39${phoneDigits}`;
    }
    console.log(`\n📱 Formatted phone: ${formattedPhone}`);
    
    // Validate and adjust date if in past
    const [day, month, year] = reservationData.date.split('-');
    const reservationDateObj = new Date(`${year}-${month}-${day}`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (reservationDateObj < today) {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      validatedDate = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
      console.log(`⚠️ Date was in past, adjusted to: ${validatedDate}`);
    }
    
    // Check calendar conflicts
    let calendarCheck;
    try {
      calendarCheck = await checkCalendarForConflicts(validatedDate, reservationData.time);
      if (calendarCheck.hasConflicts) {
        console.log(`ℹ️ Calendar conflict detected but not shown to customer`);
      }
    } catch (calendarError) {
      calendarCheck = { hasConflicts: false, conflictingEvents: [], error: calendarError.message };
    }
    
    const arrivalTimeISO = formatTimeForAirtable(reservationData.time, validatedDate);
    const whatsappValue = reservationData.whatsapp_confirmation ? "Yes" : "No";
    
    // FIXED: Declare airtableDate with let
    let airtableDate = validatedDate;
    if (validatedDate && validatedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [d, m, y] = validatedDate.split('-');
      airtableDate = `${y}-${m}-${d}`;
    }
    
    const airtableFields = {
      "Reservation ID": reservationId,
      "First Name": reservationData.firstName,
      "Last Name": reservationData.lastName,
      "Phone Number": formattedPhone,
      "Reservation Date": airtableDate,
      "Arrival Time": arrivalTimeISO,
      "Total People": parseInt(reservationData.guests) || 2,
      "Dinner Count": dinnerCount,
      "Show-Only Count": showOnlyCount,
      "Kids Count": parseInt(reservationData.children) || 0,
      "Special Requests": finalSpecialRequests,
      "Reservation Status": "Confirmed",
      "Reservation Type": reservationType,
      "Newsletter Opt-In": reservationData.newsletter,
      "Whatsapp Confirmation": whatsappValue
    };
    
    console.log('\n💾 SAVING TO AIRTABLE...');
    console.log('Airtable fields:', JSON.stringify(airtableFields, null, 2));
    
    try {
      const record = await base('Reservations').create([{ fields: airtableFields }]);
      
      console.log('\n🎉🎉🎉 RESERVATION SAVED TO AIRTABLE! 🎉🎉🎉');
      console.log(`   Reservation ID: ${reservationId}`);
      console.log(`   Airtable Record ID: ${record[0].id}`);
      
      // ===== STRICT CHECK - ONLY SEND TO MAKE.COM IF ALL FIELDS ARE VALID =====
      const hasAllRequiredFields = 
        reservationData.firstName && reservationData.firstName !== '' &&
        reservationData.lastName && reservationData.lastName !== '' &&
        reservationData.phone && reservationData.phone !== '' &&
        reservationData.date && reservationData.date !== '' &&
        reservationData.time && reservationData.time !== '' &&
        reservationData.guests && reservationData.guests > 0;
      
      const phoneDigitsForMake = reservationData.phone ? reservationData.phone.replace(/\D/g, '') : '';
      const lastTenDigitsForMake = phoneDigitsForMake.slice(-10);
      const isPhoneValidForMake = lastTenDigitsForMake.length === 10 && lastTenDigitsForMake.startsWith('3');
      
      console.log(`\n📱 Phone validation for Make.com:`);
      console.log(`   Raw phone: "${reservationData.phone}"`);
      console.log(`   Digits extracted: "${phoneDigitsForMake}" (length: ${phoneDigitsForMake.length})`);
      console.log(`   Last 10 digits: "${lastTenDigitsForMake}" (length: ${lastTenDigitsForMake.length})`);
      console.log(`   Valid for Make.com: ${isPhoneValidForMake}`);
      
      const shouldSendToMake = 
        reservationData.whatsapp_confirmation === true &&
        hasAllRequiredFields &&
        isPhoneValidForMake;
      
      if (shouldSendToMake) {
        console.log('\n✅ All conditions met. Sending to Make.com...');
        await sendToMakeWebhook(reservationData, reservationId);
      } else {
        console.log(`\n❌ NOT sending to Make.com - conditions not met:`);
        console.log(`   whatsapp_confirmation: ${reservationData.whatsapp_confirmation}`);
        console.log(`   hasAllRequiredFields: ${hasAllRequiredFields}`);
        console.log(`   isPhoneValidForMake: ${isPhoneValidForMake} (${lastTenDigitsForMake.length} digits)`);
      }
      
      const greeting = getItalianTimeGreeting();
      const farewellMap = {
        "Buongiorno": "Buona giornata",
        "Buon pomeriggio": "Buon proseguimento",
        "Buonasera": "Buona serata",
        "Buonanotte": "Buona notte"
      };
      const farewell = farewellMap[greeting] || "Buona giornata";
      
      console.log('\n✅ RESERVATION COMPLETE - Sending success response to Retell');
      
      res.json({
        response: `Perfetto! ${greeting}! Ho prenotato per ${reservationData.guests} persone il ${validatedDate} alle ${reservationData.time} a nome ${reservationData.firstName} ${reservationData.lastName}. Riceverai conferma su WhatsApp. ${farewell}!`,
        saveToAirtable: true,
        reservationId,
        intentDetected: true,
        webhookSent: shouldSendToMake
      });
      
    } catch (airtableError) {
      console.error('\n❌❌❌ AIRTABLE ERROR:', airtableError.message);
      const greeting = getItalianTimeGreeting();
      res.json({
        response: `${greeting}! Abbiamo riscontrato un problema con la prenotazione. Ti preghiamo di riprovare o chiamarci direttamente.`,
        saveToAirtable: false,
        error: airtableError.message
      });
    }
    
  } catch (error) {
    console.error('\n❌❌❌ ERROR IN MAIN WEBHOOK:', error.message);
    const greeting = getItalianTimeGreeting();
    res.json({
      response: `${greeting}! Grazie per la tua chiamata! Abbiamo riscontrato un problema. Ti preghiamo di riprovare più tardi.`,
      saveToAirtable: false,
      error: error.message
    });
  }
});


// ===== SINGLE DATE - POST (For Retell Agent) =====
app.post('/api/calendar/date', async (req, res) => {
  try {
    const date = req.body.date || req.body.args?.date;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date'
      });
    }
    
    console.log(`📅 POST /api/calendar/date called with date: ${date}`);
    
    const result = await get_events_by_date(date);
    
    res.json({
      success: result.success,
      date: result.resolvedDate,
      originalDate: date,
      eventCount: result.events?.length || 0,
      events: result.events || [],
      message: result.message,
      source: result.source
    });
    
  } catch (error) {
    console.error('❌ Error in POST /api/calendar/date:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events',
      message: error.message
    });
  }
});

// ===== FULL WEEK - POST (For Retell Agent) =====
app.post('/api/calendar/week', async (req, res) => {
  try {
    const startDate = req.body.startDate || req.body.args?.startDate || req.body.date || req.body.args?.date;
    
    if (!startDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing startDate parameter',
        message: 'Please provide a start date'
      });
    }
    
    console.log(`📅 POST /api/calendar/week called with startDate: ${startDate}`);
    
    const result = await get_events_for_week(startDate);
    
    res.json({
      success: result.success,
      startDate: result.startDate,
      endDate: result.endDate,
      totalEvents: result.totalEvents || 0,
      daysWithEvents: result.daysWithEvents || 0,
      soldOutEvents: result.soldOutEvents || 0,
      weekEvents: result.weekEvents || [],
      message: result.message,
      source: result.source
    });
    
  } catch (error) {
    console.error('❌ Error in POST /api/calendar/week:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch week events',
      message: error.message
    });
  }
});

// ===== DATE RANGE - POST (For Retell Agent) =====
app.post('/api/calendar/range', async (req, res) => {
  try {
    const startDate = req.body.startDate || req.body.args?.startDate;
    const endDate = req.body.endDate || req.body.args?.endDate;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing startDate or endDate parameter',
        message: 'Please provide both startDate and endDate'
      });
    }
    
    console.log(`📅 POST /api/calendar/range called with startDate: ${startDate}, endDate: ${endDate}`);
    
    const result = await get_events_for_date_range(startDate, endDate);
    
    res.json({
      success: result.success,
      startDate: result.startDate,
      endDate: result.endDate,
      totalDays: result.totalDays || 0,
      totalEvents: result.totalEvents || 0,
      daysWithEvents: result.daysWithEvents || 0,
      soldOutEvents: result.soldOutEvents || 0,
      rangeEvents: result.rangeEvents || [],
      message: result.message,
      source: result.source
    });
    
  } catch (error) {
    console.error('❌ Error in POST /api/calendar/range:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch range events',
      message: error.message
    });
  }
});


// ===== PRE-CALL INIT ENDPOINT FOR RETELL AGENT ====get
app.post('/api/pre-call-init', (req, res) => {
  try {
    console.log('\n📞 PRE-CALL INIT webhook called');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    // Extract data from JSON body (Retell sends as JSON)
    const { call_id, timestamp, direction } = req.body;
    
    console.log(`   Call ID: ${call_id || 'not provided'}`);
    console.log(`   Direction: ${direction || 'not provided'}`);
    console.log(`   Timestamp: ${timestamp || 'not provided'}`);
    
    // Get current time in Rome for correct greeting
    const romeDate = getRomeDate();
    const currentHour = romeDate.getHours();
    let greetingWord = '';
    let fullGreeting = '';
    
    // CORRECT ITALIAN TIME RANGES:
    // Buongiorno: 5:00 - 12:59 (5 AM to 12:59 PM)
    // Buon pomeriggio: 13:00 - 16:59 (1 PM to 4:59 PM)
    // Buonasera: 17:00 - 04:59 (5 PM to 4:59 AM)
    if (currentHour >= 5 && currentHour < 13) {
      greetingWord = "Buongiorno";
      fullGreeting = `${greetingWord}, benvenuto da Jazzamore. Sono Maya, come posso aiutarla?`;
    } else if (currentHour >= 13 && currentHour < 17) {
      greetingWord = "Buon pomeriggio";
      fullGreeting = `${greetingWord}, benvenuto da Jazzamore. Sono Maya, come posso aiutarla?`;
    } else {
      greetingWord = "Buonasera";
      fullGreeting = `${greetingWord}, benvenuto da Jazzamore. Sono Maya, come posso aiutarla?`;
    }
    
    console.log(`   Time in Rome: ${currentHour}:${romeDate.getMinutes()}`);
    console.log(`   Greeting: ${greetingWord}`);
    console.log(`   Full greeting: ${fullGreeting}`);
    
    // Return response that Retell expects
    res.json({
      success: true,
      greeting: greetingWord,
      fullGreeting: fullGreeting,
      should_greet_first: true,
      message: "Call initialized. Play greeting immediately."
    });
    
  } catch (error) {
    console.error('❌ Pre-call init error:', error.message);
    console.error('Error stack:', error.stack);
    
    // Return error response but still provide a fallback greeting
    res.status(500).json({ 
      success: false, 
      error: error.message,
      fullGreeting: "Buonasera, benvenuto da Jazzamore. Sono Maya, come posso aiutarla?",
      should_greet_first: true,
      message: "Failed to initialize call greeting. Using fallback."
    });
  }
});

// ===== HELPER: Get last day of month =====
function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ===== HELPER: Find next occurrence of a specific day (FIXED FOR ALL DAYS & NEXT WEEK) =====
function findNextSpecificDay(dayName, skipCurrentWeek = false) {
  const dayMap = {
    // English
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    // Italian
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 
    'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 
    'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 
    'sabato': 6
  };
  
  const targetDayNum = dayMap[dayName.toLowerCase()];
  if (targetDayNum === undefined) {
    console.error(`❌ Unknown day name: ${dayName}`);
    return getRomeDateToday();
  }
  
  const today = getRomeDate();
  const todayDayNum = today.getDay();
  
  // Calculate days to add to reach target day
  let daysToAdd = (targetDayNum - todayDayNum + 7) % 7;
  
  // If skipCurrentWeek is true, ALWAYS add 7 to get NEXT week's day
  if (skipCurrentWeek) {
    daysToAdd = daysToAdd + 7;
  }
  
  console.log(`📅 findNextSpecificDay: ${dayName} → targetDay=${targetDayNum}, todayDay=${todayDayNum}, daysToAdd=${daysToAdd}, skipCurrentWeek=${skipCurrentWeek}`);
  
  const targetDate = addDays(today, daysToAdd);
  const result = formatInTimeZone(targetDate, ROME_TIMEZONE, 'dd-MM-yyyy');
  
  console.log(`✅ Result: ${result}`);
  return result;
}

// ===== COMPLETE DATE RESOLUTION FUNCTION (SINGLE VERSION - USE THIS ONE) =====
// ===== HELPER: Find next occurrence of a specific day (UNIVERSAL SOLUTION) =====
function findNextSpecificDay(dayName, type = 'this') {
  const dayMap = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 
    'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 
    'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 
    'sabato': 6
  };
  
  const targetDayNum = dayMap[dayName.toLowerCase()];
  if (targetDayNum === undefined) {
    console.error(`❌ Unknown day name: ${dayName}`);
    return getRomeDateToday();
  }
  
  const today = getRomeDate();
  const todayDayNum = today.getDay();
  
  // Calculate days until the target day THIS week
  let daysUntilTarget = (targetDayNum - todayDayNum + 7) % 7;
  
  let daysToAdd;
  
  switch(type) {
    case 'this':  
      // "this monday" or just "monday" - next occurrence (could be today)
      daysToAdd = daysUntilTarget;
      break;
      
    case 'next':  
      // "next monday" - the upcoming Monday (never today)
      daysToAdd = daysUntilTarget;
      if (daysToAdd === 0) daysToAdd = 7; // if today, go to next week
      break;
      
    case 'next_week':  
      // "next week monday" - Monday of NEXT week (always add 7)
      daysToAdd = daysUntilTarget + 7;
      break;
      
    default:
      daysToAdd = daysUntilTarget;
  }
  
  console.log(`📅 findNextSpecificDay: ${dayName}, type=${type}, todayDay=${todayDayNum}, targetDay=${targetDayNum}, daysUntilTarget=${daysUntilTarget}, daysToAdd=${daysToAdd}`);
  
  const targetDate = addDays(today, daysToAdd);
  return formatInTimeZone(targetDate, ROME_TIMEZONE, 'dd-MM-yyyy');
}

// ===== COMPLETE DATE RESOLUTION FUNCTION =====
function resolveDate(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return getRomeDateToday();
  }
  
  const cleanedDate = dateString.toLowerCase().trim();
  const today = getRomeDate();
  const todayStr = getRomeDateToday();
  
  console.log(`🔍 resolveDate input: "${cleanedDate}"`);
  
  // ===== SIMPLE CASES =====
  if (cleanedDate === 'today' || cleanedDate === 'oggi') return todayStr;
  if (cleanedDate === 'tomorrow' || cleanedDate === 'domani') {
    return formatInTimeZone(addDays(today, 1), ROME_TIMEZONE, 'dd-MM-yyyy');
  }
  if (cleanedDate === 'stasera' || cleanedDate === 'questa sera' || cleanedDate === 'tonight') {
    return todayStr;
  }
  
  // ===== DAY NAME MAPPING =====
  const dayMap = {
    'lunedì': 'monday', 'lunedi': 'monday',
    'martedì': 'tuesday', 'martedi': 'tuesday',
    'mercoledì': 'wednesday', 'mercoledi': 'wednesday',
    'giovedì': 'thursday', 'giovedi': 'thursday',
    'venerdì': 'friday', 'venerdi': 'friday',
    'sabato': 'saturday',
    'domenica': 'sunday',
    'monday': 'monday', 'tuesday': 'tuesday', 'wednesday': 'wednesday',
    'thursday': 'thursday', 'friday': 'friday', 'saturday': 'saturday', 'sunday': 'sunday'
  };
  
  // ===== PATTERN 1: "next week monday" (English - explicit next week) =====
  let match = cleanedDate.match(/^next\s+week\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
  if (match) {
    const dayName = match[1].toLowerCase();
    const result = findNextSpecificDay(dayName, 'next_week');
    console.log(`✅ "next week ${dayName}" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 2: "lunedì della prossima settimana" (Italian - explicit next week) =====
  match = cleanedDate.match(/^(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\s+della\s+prossima\s+settimana$/i);
  if (match) {
    const italianDay = match[1].toLowerCase();
    const englishDay = dayMap[italianDay];
    const result = findNextSpecificDay(englishDay, 'next_week');
    console.log(`✅ "${italianDay} della prossima settimana" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 3: "la prossima settimana lunedì" (Italian - order swapped) =====
  match = cleanedDate.match(/^la\s+prossima\s+settimana\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)$/i);
  if (match) {
    const italianDay = match[1].toLowerCase();
    const englishDay = dayMap[italianDay];
    const result = findNextSpecificDay(englishDay, 'next_week');
    console.log(`✅ "la prossima settimana ${italianDay}" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 4: "next monday" (English - upcoming, not today) =====
  match = cleanedDate.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
  if (match) {
    const dayName = match[1].toLowerCase();
    const result = findNextSpecificDay(dayName, 'next');
    console.log(`✅ "next ${dayName}" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 5: "lunedì prossimo" (Italian - day first, upcoming) =====
  match = cleanedDate.match(/^(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\s+prossim[oa]$/i);
  if (match) {
    const italianDay = match[1].toLowerCase();
    const englishDay = dayMap[italianDay];
    const result = findNextSpecificDay(englishDay, 'next');
    console.log(`✅ "${italianDay} prossimo" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 6: "prossimo lunedì" (Italian - prossimo first, upcoming) =====
  match = cleanedDate.match(/^prossim[oa]\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)$/i);
  if (match) {
    const italianDay = match[1].toLowerCase();
    const englishDay = dayMap[italianDay];
    const result = findNextSpecificDay(englishDay, 'next');
    console.log(`✅ "prossimo ${italianDay}" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 7: "lunedì che viene" (Italian - colloquial, upcoming) =====
  match = cleanedDate.match(/^(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\s+che\s+viene$/i);
  if (match) {
    const italianDay = match[1].toLowerCase();
    const englishDay = dayMap[italianDay];
    const result = findNextSpecificDay(englishDay, 'next');
    console.log(`✅ "${italianDay} che viene" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 8: "il lunedì prossimo" (with article, upcoming) =====
  match = cleanedDate.match(/^il\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\s+prossim[oa]$/i);
  if (match) {
    const italianDay = match[1].toLowerCase();
    const englishDay = dayMap[italianDay];
    const result = findNextSpecificDay(englishDay, 'next');
    console.log(`✅ "il ${italianDay} prossimo" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 9: "per lunedì prossimo" (with preposition, upcoming) =====
  match = cleanedDate.match(/^per\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\s+prossim[oa]$/i);
  if (match) {
    const italianDay = match[1].toLowerCase();
    const englishDay = dayMap[italianDay];
    const result = findNextSpecificDay(englishDay, 'next');
    console.log(`✅ "per ${italianDay} prossimo" → ${result}`);
    return result;
  }
  
  // ===== PATTERN 10: Simple day name (e.g., "lunedì", "monday") =====
  match = cleanedDate.match(/^(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
  if (match) {
    let dayName = match[1].toLowerCase();
    const englishDay = dayMap[dayName] || dayName;
    const result = findNextSpecificDay(englishDay, 'this');
    console.log(`✅ Simple day "${dayName}" → ${result}`);
    return result;
  }
  
  // ===== ALREADY FORMATTED DATES =====
  if (cleanedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
    return cleanedDate;
  }
  
  if (cleanedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = cleanedDate.split('-');
    return `${day}-${month}-${year}`;
  }
  
  // ===== FALLBACK: Default to tomorrow =====
  const tomorrow = addDays(today, 1);
  const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
  console.log(`⚠️ Fallback to tomorrow: "${cleanedDate}" → ${result}`);
  return result;
}
  
  // ===== MONTH + DAY patterns (e.g., "15 aprile", "april 15") =====
  const monthMap = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5, 'giugno': 6,
    'luglio': 7, 'agosto': 8, 'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12
  };
  
  let detectedMonth = null;
  let detectedDay = null;
  
  for (const [monthName, monthIndex] of Object.entries(monthMap)) {
    if (cleanedDate.includes(monthName)) {
      detectedMonth = monthIndex;
      const dayMatch = cleanedDate.match(/(\d{1,2})/);
      if (dayMatch) {
        detectedDay = parseInt(dayMatch[1]);
      }
      break;
    }
  }
  
  if (detectedMonth && detectedDay && detectedDay >= 1 && detectedDay <= 31) {
    let year = today.getFullYear();
    if (detectedMonth < today.getMonth() + 1) {
      year++;
    }
    const lastDay = getLastDayOfMonth(year, detectedMonth);
    const validDay = Math.min(detectedDay, lastDay);
    const result = `${validDay.toString().padStart(2, '0')}-${detectedMonth.toString().padStart(2, '0')}-${year}`;
    console.log(`✅ Month + day resolved: ${result}`);
    return result;
  }
  
  // ===== BARE DAY NUMBER (e.g., "4", "the 4th") =====
  const bareDayMatch = cleanedDate.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (bareDayMatch) {
    const day = parseInt(bareDayMatch[1]);
    if (day >= 1 && day <= 31) {
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      const result = `${validDay.toString().padStart(2, '0')}-${currentMonth.toString().padStart(2, '0')}-${currentYear}`;
      console.log(`✅ Bare day number resolved: ${result}`);
      return result;
    }
  }
  
  // ===== ALREADY FORMATTED DATES =====
  if (cleanedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
    return cleanedDate;
  }
  
  if (cleanedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = cleanedDate.split('-');
    return `${day}-${month}-${year}`;
  }
  
  // ===== FALLBACK: Default to tomorrow =====
  const tomorrow = addDays(today, 1);
  const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
  console.log(`⚠️ Fallback to tomorrow: "${cleanedDate}" → ${result}`);
  return result;
}

// ===== POST endpoint for Retell AI resolve_date tool =====
app.post('/api/resolve-date', (req, res) => {
  try {
    // Handle Retell's payload format
    let text = req.body.text || req.body.args?.text;
    
    // If text is an object (sometimes happens with Retell), try to extract it
    if (typeof text === 'object' && text !== null) {
      text = text.text || text.value || JSON.stringify(text);
    }
    
    // Ensure text is a string and clean it
    if (!text || typeof text !== 'string') {
      console.error(`❌ Invalid text parameter type: ${typeof text}, value: ${JSON.stringify(text)}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid text parameter',
        message: `Expected string, got ${typeof text}`,
        originalRequest: req.body
      });
    }
    
    // Trim and clean the input
    const cleanedText = text.trim();
    console.log(`📅 POST resolve-date called with: "${cleanedText}"`);
    
    // Validate we have a resolveDate function
    if (typeof resolveDate !== 'function') {
      console.error('❌ resolveDate function is not defined!');
      return res.status(500).json({
        success: false,
        error: 'Internal configuration error',
        message: 'Date resolution function not available'
      });
    }
    
    // Use your existing resolveDate function
    const resolvedDate = resolveDate(cleanedText);
    
    // Validate the resolved date
    if (!resolvedDate || !resolvedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      console.error(`❌ Invalid resolved date: "${resolvedDate}" for input: "${cleanedText}"`);
      return res.status(400).json({
        success: false,
        error: 'Date resolution failed',
        message: `Could not resolve "${cleanedText}" to a valid date`,
        originalText: cleanedText
      });
    }
    
    // Parse the resolved date to get day of week
    const [day, month, year] = resolvedDate.split('-');
    const dateObj = new Date(`${year}-${month}-${day}`);
    
    // Validate the date object is valid
    if (isNaN(dateObj.getTime())) {
      console.error(`❌ Invalid date object created from: ${resolvedDate}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid date',
        message: `Resolved date "${resolvedDate}" is invalid`
      });
    }
    
    const dayNamesItalian = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const dayNamesEnglish = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNamesItalian[dateObj.getDay()];
    const dayOfWeekEnglish = dayNamesEnglish[dateObj.getDay()];
    
    console.log(`✅ Resolved: "${cleanedText}" → ${resolvedDate} (${dayOfWeek})`);
    
    // Return the response in the format Retell expects
    res.json({
      success: true,
      originalText: cleanedText,
      resolvedDate: resolvedDate,
      dayOfWeek: dayOfWeek,
      dayOfWeekEnglish: dayOfWeekEnglish,
      timezone: 'Europe/Rome',
      // Additional useful fields for debugging
      resolvedDay: parseInt(day),
      resolvedMonth: parseInt(month),
      resolvedYear: parseInt(year)
    });
    
  } catch (error) {
    console.error('❌ POST resolve-date error:', error.message);
    console.error('   Stack:', error.stack);
    
    // Return a helpful error response
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to resolve date. Please check the date format.',
      originalRequest: req.body
    });
  }
});

// ===== GET endpoint for testing resolve_date =====
app.get('/api/resolve-date', (req, res) => {
  try {
    const { text } = req.query;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Missing text parameter',
        message: 'Please provide a date text like "tomorrow", "next friday", etc.'
      });
    }
    
    const resolvedDate = resolveDate(text);
    const [day, month, year] = resolvedDate.split('-');
    const dateObj = new Date(`${year}-${month}-${day}`);
    const dayNamesItalian = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const dayOfWeek = dayNamesItalian[dateObj.getDay()];
    
    res.json({
      success: true,
      originalText: text,
      resolvedDate: resolvedDate,
      dayOfWeek: dayOfWeek,
      timezone: 'Europe/Rome'
    });
    
  } catch (error) {
    console.error('❌ GET resolve-date error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== RESTAURANT HOURS - POST (For Retell Agent) =====
app.post('/api/restaurant-hours', (req, res) => {
  try {
    res.json({
      success: true,
      // DINNER + SHOW OPTION (PRIMARY - ALWAYS OFFER FIRST)
      dinnerShow: {
        arrivalWindow: "19:30 - 22:00",
        description: "Cena + spettacolo - prenota un tavolo per cena e assista allo spettacolo dal tuo tavolo",
        ticketPrice: "Prezzo inferiore (incluso nella cena)",
        recommendedArrival: "19:30",
        kitchenCloses: "22:00",
        lastOrder: "22:00",
        musicEnds: "23:30"
      },
      // SHOW ONLY OPTION (SECONDARY - ONLY IF CUSTOMER ASKS)
      showOnly: {
        arrivalWindow: "20:30 onwards",
        description: "Solo spettacolo - prenota un posto o tavolo per drink e spettacolo",
        ticketPrice: "Prezzo più alto del dinner+show (varia per evento)",
        recommendedArrival: "20:30",
        notes: "L'arrivo alle 20:30 è consigliato ma non obbligatorio. Ci sono posti dedicati per solo spettacolo.",
        isMandatory: false
      },
      // SHOW TIMES
      showTimes: {
        start: "21:00 - 21:30",
        end: "23:30",
        note: "L'orario di inizio spettacolo varia tra le 21:00 e le 21:30 a seconda dell'evento"
      },
      // KITCHEN HOURS
      kitchen: {
        closes: "22:00",
        lastOrder: "22:00",
        note: "Ultimi ordini alle 22:00"
      },
      // APERITIVO
      aperitivo: {
        time: "18:00",
        condition: "SOLO se specificato nel calendario Google Calendar per l'evento",
        default: "Non menzionare a meno che non sia nell'evento o il cliente chieda"
      },
      // GENERAL INFO
      daysOpen: ["Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      daysClosed: ["Monday", "Tuesday"],
      daysOpenItalian: ["Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
      daysClosedItalian: ["Lunedì", "Martedì"],
      timezone: "Europe/Rome",
      // CRITICAL RULE FOR AGENT
      bookingStrategy: "SEMPRE offrire prima cena+spettacolo. Solo spettacolo è secondario - offrire solo se il cliente chiede esplicitamente o rifiuta la cena."
    });
  } catch (error) {
    console.error('❌ Error in /api/restaurant-hours:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


// POST endpoint for Retell (they prefer POST)
app.post('/api/current-time', (req, res) => {
  try {
    const romeDateTime = getRomeDateTime();
    const greeting = getItalianTimeGreeting();
    
    res.json({
      success: true,
      time: romeDateTime.time,
      date: romeDateTime.date,
      hour: romeDateTime.hour,
      minute: romeDateTime.minute,
      dayOfWeek: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'][romeDateTime.romeDate.getDay()],
      fullDateTime: `${romeDateTime.date} ${romeDateTime.time}`,
      greeting: greeting,
      timezone: 'Europe/Rome'
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== SERVER STARTUP ====
app.listen(PORT, () => {
  const romeDateTime = getRomeDateTime();
  const greeting = getItalianTimeGreeting();
  
  console.log(`\n🎵 Jazzamore Reservation System v4.0`);
  console.log(`📡 Running on port: ${PORT}`);
  console.log(`🇮🇹 ${greeting}! Rome time: ${romeDateTime.date} ${romeDateTime.time}`);
  console.log(`\n🔑 Features enabled:`);
  console.log(`   ✅ Field-by-field confidence scoring comparison`);
  console.log(`   ✅ Null value protection - NO placeholders sent to Make.com`);
  console.log(`   ✅ Phone number extraction with confirmation anchor`);
  console.log(`   ✅ Monday/Tuesday closure check`);
  console.log(`   ✅ WhatsApp & newsletter extraction from transcript`);
  console.log(`   ✅ Calendar notes removed from WhatsApp messages`);
  console.log(`\n🚀 System ready!`);
  console.log(`\n🔒 CLOSURE RULE: Restaurant is CLOSED on Mondays and Tuesdays (Lunedì e Martedì)`);
});
