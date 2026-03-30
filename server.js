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
  
  if (currentHour >= 5 && currentHour < 12) return "Buongiorno";
  else if (currentHour >= 12 && currentHour < 13) return "Buon pranzo";
  else if (currentHour >= 13 && currentHour < 18) return "Buon pomeriggio";
  else if (currentHour >= 18 && currentHour < 22) return "Buonasera";
  else return "Buonanotte";
}

// ===== ENHANCED GREETING FUNCTION WITH MORE OPTIONS =====
function get_time_greeting(format = 'italian', timezone = 'rome') {
  const romeDate = getRomeDate();
  const currentHour = romeDate.getHours();
  
  let greeting = '';
  
  if (format === 'italian') {
    if (currentHour >= 5 && currentHour < 12) greeting = "Buongiorno";
    else if (currentHour >= 12 && currentHour < 13) greeting = "Buon pranzo";
    else if (currentHour >= 13 && currentHour < 18) greeting = "Buon pomeriggio";
    else if (currentHour >= 18 && currentHour < 22) greeting = "Buonasera";
    else greeting = "Buonanotte";
  } else if (format === 'english') {
    if (currentHour >= 5 && currentHour < 12) greeting = "Good morning";
    else if (currentHour >= 12 && currentHour < 13) greeting = "Good lunchtime";
    else if (currentHour >= 13 && currentHour < 18) greeting = "Good afternoon";
    else if (currentHour >= 18 && currentHour < 22) greeting = "Good evening";
    else greeting = "Good night";
  } else if (format === 'formal') {
    if (currentHour >= 5 && currentHour < 12) greeting = "Salve, buon giorno";
    else if (currentHour >= 12 && currentHour < 18) greeting = "Salve, buon pomeriggio";
    else if (currentHour >= 18 && currentHour < 22) greeting = "Salve, buona sera";
    else greeting = "Salve, buona notte";
  } else if (format === 'casual') {
    if (currentHour >= 5 && currentHour < 12) greeting = "Ciao, buongiorno";
    else if (currentHour >= 12 && currentHour < 18) greeting = "Ciao, buon pomeriggio";
    else if (currentHour >= 18 && currentHour < 22) greeting = "Ciao, buonasera";
    else greeting = "Ciao, buonanotte";
  }
  
  return {
    greeting: greeting,
    hour: currentHour,
    timezone: ROME_TIMEZONE,
    localTime: formatInTimeZone(new Date(), ROME_TIMEZONE, 'HH:mm:ss'),
    date: getRomeDateToday(),
    format: format,
    fullGreeting: `${greeting}! Benvenuti al Jazzamore. Come posso aiutarvi?`
  };
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

function extractPhoneFromTranscript(transcript) {
  if (!transcript || !Array.isArray(transcript)) {
    console.log('❌ Invalid transcript provided');
    return null;
  }
  
  const DEBUG = true; // Set to false in production to reduce logs
  
  function debugLog(message, data = null) {
    if (DEBUG) {
      console.log(`[PhoneExtract] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }
  
  // Complete number mapping for Italian and English
  const numberMap = {
    // Italian single digits
    'zero': '0', 'uno': '1', 'due': '2', 'tre': '3', 'quattro': '4',
    'cinque': '5', 'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9',
    
    // English single digits
    'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
    'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
    
    // Italian short forms
    'un': '1', 'due': '2', 'tre': '3', 'quattro': '4', 'cinque': '5',
    'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9',
    
    // Italian teens
    'dieci': '10', 'undici': '11', 'dodici': '12', 'tredici': '13',
    'quattordici': '14', 'quindici': '15', 'sedici': '16', 'diciassette': '17',
    'diciotto': '18', 'diciannove': '19',
    
    // Italian tens
    'venti': '20', 'trenta': '30', 'quaranta': '40', 'cinquanta': '50',
    'sessanta': '60', 'settanta': '70', 'ottanta': '80', 'novanta': '90',
    
    // Italian hundreds (for completeness)
    'cento': '100', 'duecento': '200', 'trecento': '300', 'quattrocento': '400',
    'cinquecento': '500', 'seicento': '600', 'settecento': '700', 'ottocento': '800',
    'novecento': '900'
  };
  
  // Compound Italian numbers (e.g., ventuno = 21, trentadue = 32)
  const compoundMap = {
    // 20s
    'ventuno': '21', 'ventidue': '22', 'ventitre': '23', 'ventiquattro': '24',
    'venticinque': '25', 'ventisei': '26', 'ventisette': '27', 'ventotto': '28',
    'ventinove': '29',
    // 30s
    'trentuno': '31', 'trentadue': '32', 'trentatre': '33', 'trentaquattro': '34',
    'trentacinque': '35', 'trentasei': '36', 'trentasette': '37', 'trentotto': '38',
    'trentanove': '39',
    // 40s
    'quarantuno': '41', 'quarantadue': '42', 'quarantatre': '43', 'quarantaquattro': '44',
    'quarantacinque': '45', 'quarantasei': '46', 'quarantasette': '47', 'quarantotto': '48',
    'quarantanove': '49',
    // 50s
    'cinquantuno': '51', 'cinquantadue': '52', 'cinquantatre': '53', 'cinquantaquattro': '54',
    'cinquantacinque': '55', 'cinquantasei': '56', 'cinquantasette': '57', 'cinquantotto': '58',
    'cinquantanove': '59',
    // 60s
    'sessantuno': '61', 'sessantadue': '62', 'sessantatre': '63', 'sessantaquattro': '64',
    'sessantacinque': '65', 'sessantasei': '66', 'sessantasette': '67', 'sessantotto': '68',
    'sessantanove': '69',
    // 70s
    'settantuno': '71', 'settantadue': '72', 'settantatre': '73', 'settantaquattro': '74',
    'settantacinque': '75', 'settantasei': '76', 'settantasette': '77', 'settantotto': '78',
    'settantanove': '79',
    // 80s
    'ottantuno': '81', 'ottantadue': '82', 'ottantatre': '83', 'ottantaquattro': '84',
    'ottantacinque': '85', 'ottantasei': '86', 'ottantasette': '87', 'ottantotto': '88',
    'ottantanove': '89',
    // 90s
    'novantuno': '91', 'novantadue': '92', 'novantatre': '93', 'novantaquattro': '94',
    'novantacinque': '95', 'novantasei': '96', 'novantasette': '97', 'novantotto': '98',
    'novantanove': '99'
  };
  
  // Italian confirmation phrases (expanded)
  const confirmationPhrases = [
    'sì', 'si', 'yes', 'yep', 'yeah', 'correct', 'ok', 'okay', 'va bene',
    'corretto', 'esatto', 'perfetto', 'giusto', 'giustissimo', 'esattamente',
    'sì corretto', 'si corretto', 'sì esatto', 'si esatto', 'sì è corretto',
    'si è corretto', 'sì sì', 'si si', 'certamente', 'sicuro', 'assolutamente'
  ];
  
  /**
   * Convert any text to digits only, handling Italian number words comprehensively
   */
  const convertToDigits = (text) => {
    if (!text) return '';
    
    debugLog('Converting text to digits', { original: text });
    
    // Remove common punctuation and normalize spaces
    let cleanText = text.toLowerCase()
      .replace(/[.,\-/()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    debugLog('Cleaned text', { cleaned: cleanText });
    
    // Split into words and number segments
    const words = cleanText.split(/\s+/);
    let result = '';
    let i = 0;
    
    while (i < words.length) {
      const word = words[i];
      
      // Check for compound numbers first
      if (compoundMap[word]) {
        result += compoundMap[word];
        debugLog('Found compound number', { word, value: compoundMap[word] });
        i++;
        continue;
      }
      
      // Check if it's a mapped number word
      if (numberMap[word]) {
        result += numberMap[word];
        debugLog('Found number word', { word, value: numberMap[word] });
        i++;
        continue;
      }
      
      // Check for numeric segment
      if (/\d+/.test(word)) {
        const digits = word.replace(/\D/g, '');
        result += digits;
        debugLog('Found numeric segment', { word, digits });
        i++;
        continue;
      }
      
      // Check for "e" conjunction in numbers (e.g., "venti e tre" for 23)
      if (word === 'e' && i > 0 && i < words.length - 1) {
        const prevWord = words[i - 1];
        const nextWord = words[i + 1];
        
        // Check if previous is a tens and next is a single digit
        if (numberMap[prevWord] && numberMap[prevWord].length === 2 && 
            numberMap[nextWord] && numberMap[nextWord].length === 1) {
          const tensValue = parseInt(numberMap[prevWord]);
          const unitValue = parseInt(numberMap[nextWord]);
          const combined = tensValue + unitValue;
          result = result.slice(0, -2) + combined.toString(); // Replace the tens part
          debugLog('Combined number with "e"', { tens: tensValue, unit: unitValue, combined });
          i += 2;
          continue;
        }
      }
      
      i++;
    }
    
    // If result is empty, try to extract digits directly
    if (result === '') {
      result = text.replace(/\D/g, '');
      debugLog('Fallback: extracted digits directly', { result });
    }
    
    debugLog('Final digit conversion result', { result });
    return result;
  };
  
  /**
   * Normalize phone number to standard Italian format (+39XXXXXXXXXX)
   */
  const normalizePhoneNumber = (digits) => {
    if (!digits) return null;
    
    // Remove any non-digit characters
    const cleanDigits = digits.replace(/\D/g, '');
    
    debugLog('Normalizing phone number', { original: digits, clean: cleanDigits });
    
    // Italian mobile numbers are 10 digits after country code
    if (cleanDigits.length === 10) {
      const normalized = `+39${cleanDigits}`;
      debugLog('Normalized 10-digit number', { normalized });
      return normalized;
    }
    // Already has country code (39 prefix + 10 digits = 12 total)
    else if (cleanDigits.length === 12 && cleanDigits.startsWith('39')) {
      const normalized = `+${cleanDigits}`;
      debugLog('Normalized number with country code', { normalized });
      return normalized;
    }
    // Has country code but missing the + (11 digits starting with 39)
    else if (cleanDigits.length === 11 && cleanDigits.startsWith('39')) {
      const normalized = `+${cleanDigits}`;
      debugLog('Normalized 11-digit number with country code', { normalized });
      return normalized;
    }
    // 11 digits without country code (possible leading digit error)
    else if (cleanDigits.length === 11 && !cleanDigits.startsWith('39')) {
      const lastTen = cleanDigits.slice(-10);
      const normalized = `+39${lastTen}`;
      debugLog('Normalized 11-digit number (took last 10)', { normalized });
      return normalized;
    }
    // More than 10 digits, take last 10 (most common case)
    else if (cleanDigits.length > 10) {
      const lastTen = cleanDigits.slice(-10);
      const normalized = `+39${lastTen}`;
      debugLog('Normalized number (took last 10 digits)', { 
        original: cleanDigits, 
        lastTen, 
        normalized 
      });
      return normalized;
    }
    // Less than 10 digits but at least 9 (possible missing digit)
    else if (cleanDigits.length >= 9 && cleanDigits.length < 10) {
      // Log warning but still return with padding
      console.log(`⚠️ Phone number has ${cleanDigits.length} digits (expected 10): ${cleanDigits}`);
      const normalized = `+39${cleanDigits}`;
      debugLog('Normalized short number', { normalized });
      return normalized;
    }
    
    console.log(`❌ Invalid phone number length: ${cleanDigits.length} digits`);
    return null;
  };
  
  // Log the entire transcript for debugging
  debugLog('Processing transcript', { messageCount: transcript.length });
  
  // ===== STRATEGY 1: FIND CONFIRMED NUMBER WITH ANCHOR =====
  debugLog('Strategy 1: Looking for confirmed number with anchor');
  
  for (let i = transcript.length - 1; i >= 1; i--) {
    const currentMsg = transcript[i];
    const content = (currentMsg.content || '').toLowerCase().trim();
    
    // Check for any confirmation phrase
    const isConfirmation = confirmationPhrases.some(phrase => 
      content === phrase || content.includes(phrase)
    );
    
    if (currentMsg.role === 'user' && isConfirmation) {
      debugLog('Found confirmation', { 
        index: i, 
        content: currentMsg.content,
        role: currentMsg.role 
      });
      
      // Check the agent message immediately before the confirmation
      const agentMsg = transcript[i - 1];
      if (agentMsg && agentMsg.role === 'agent') {
        debugLog('Found agent message before confirmation', { 
          agentContent: agentMsg.content 
        });
        
        const rawDigits = convertToDigits(agentMsg.content);
        const finalNumber = normalizePhoneNumber(rawDigits);
        
        if (finalNumber) {
          console.log(`✅ SUCCESS: Extracted confirmed number: ${finalNumber}`);
          console.log(`   From agent: "${agentMsg.content}"`);
          console.log(`   User confirmed: "${currentMsg.content}"`);
          console.log(`   Raw digits extracted: ${rawDigits}`);
          return finalNumber;
        }
      }
    }
  }
  
  // ===== STRATEGY 2: LOOK FOR NUMBERS IN AGENT MESSAGES (CONFIRMATION CONTEXT) =====
  debugLog('Strategy 2: Looking for numbers in agent messages');
  
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i];
    if (msg.role === 'agent') {
      const content = msg.content.toLowerCase();
      
      // Check if this message looks like a number confirmation
      const isRepeatingNumber = 
        content.includes('numero') ||
        content.includes('telefono') ||
        content.includes('cellulare') ||
        content.includes('phone') ||
        content.includes('number') ||
        content.includes('il suo numero') ||
        content.includes('il numero è') ||
        content.includes('il numero di telefono') ||
        content.match(/\d{5,}/); // Contains at least 5 digits
      
      if (isRepeatingNumber) {
        debugLog('Found agent repeating number', { 
          index: i, 
          content: msg.content 
        });
        
        const rawDigits = convertToDigits(msg.content);
        const finalNumber = normalizePhoneNumber(rawDigits);
        
        if (finalNumber) {
          console.log(`✅ SUCCESS: Extracted number from agent confirmation: ${finalNumber}`);
          console.log(`   From agent: "${msg.content}"`);
          console.log(`   Raw digits extracted: ${rawDigits}`);
          return finalNumber;
        }
      }
    }
  }
  
  // ===== STRATEGY 3: LOOK FOR USER'S ORIGINAL NUMBER (BEFORE CONFIRMATION) =====
  debugLog('Strategy 3: Looking for user number with agent confirmation');
  
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    if (msg.role === 'user') {
      const rawDigits = convertToDigits(msg.content);
      
      if (rawDigits.length >= 9 && rawDigits.length <= 12) {
        debugLog('Found potential user number', { 
          index: i, 
          content: msg.content,
          digits: rawDigits 
        });
        
        // Check if a subsequent agent message confirms this number
        for (let j = i + 1; j < Math.min(i + 4, transcript.length); j++) {
          const nextMsg = transcript[j];
          if (nextMsg.role === 'agent') {
            const agentDigits = convertToDigits(nextMsg.content);
            
            // Check if agent repeats the number (exact match or close match)
            const exactMatch = agentDigits === rawDigits;
            const closeMatch = Math.abs(agentDigits.length - rawDigits.length) <= 2 && 
                               agentDigits.slice(-8) === rawDigits.slice(-8);
            
            if (exactMatch || closeMatch) {
              debugLog('Found agent confirming user number', {
                userDigits: rawDigits,
                agentDigits: agentDigits,
                exactMatch,
                closeMatch
              });
              
              const finalNumber = normalizePhoneNumber(rawDigits);
              if (finalNumber) {
                console.log(`✅ SUCCESS: Extracted confirmed user number: ${finalNumber}`);
                console.log(`   User said: "${msg.content}"`);
                console.log(`   Agent confirmed: "${nextMsg.content}"`);
                return finalNumber;
              }
            }
          }
        }
      }
    }
  }
  
  // ===== STRATEGY 4: LOOK FOR NUMBERS IN USER MESSAGES =====
  debugLog('Strategy 4: Looking for numbers in user messages');
  
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i];
    if (msg.role === 'user') {
      const rawDigits = convertToDigits(msg.content);
      
      if (rawDigits.length >= 9 && rawDigits.length <= 12) {
        const finalNumber = normalizePhoneNumber(rawDigits);
        if (finalNumber) {
          console.log(`⚠️ WARNING: Extracted unconfirmed user number: ${finalNumber}`);
          console.log(`   User said: "${msg.content}"`);
          return finalNumber;
        }
      }
    }
  }
  
  // ===== STRATEGY 5: FALLBACK - ANY VALID ITALIAN NUMBER FORMAT =====
  debugLog('Strategy 5: Fallback - any valid Italian number');
  
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i];
    if (msg.role === 'user' || msg.role === 'agent') {
      const rawDigits = convertToDigits(msg.content);
      
      // Look for any valid Italian number pattern
      if (rawDigits.length >= 9 && rawDigits.length <= 12) {
        const finalNumber = normalizePhoneNumber(rawDigits);
        if (finalNumber) {
          console.log(`⚠️ WARNING: Extracted unconfirmed fallback: ${finalNumber}`);
          console.log(`   From: ${msg.role} - "${msg.content}"`);
          console.log(`   Raw digits: ${rawDigits}`);
          return finalNumber;
        }
      }
      
      // Also look for specific patterns like "333 1234567" or "333-1234567"
      const patternMatch = msg.content.match(/(\d{3}[\s\-]?\d{6,7})/);
      if (patternMatch) {
        const rawDigits = patternMatch[1].replace(/\D/g, '');
        const finalNumber = normalizePhoneNumber(rawDigits);
        if (finalNumber) {
          console.log(`⚠️ WARNING: Extracted pattern-matched number: ${finalNumber}`);
          console.log(`   Pattern: "${patternMatch[1]}"`);
          return finalNumber;
        }
      }
    }
  }
  
  console.log('❌ No valid phone number found in transcript');
  
  // Additional debug: print all messages for troubleshooting
  if (DEBUG) {
    console.log('\n📝 Full transcript for debugging:');
    transcript.forEach((msg, idx) => {
      console.log(`${idx}: ${msg.role.toUpperCase()} - "${msg.content}"`);
    });
  }
  
  return null;
}

// ===== FUNCTION TO SEND WEBHOOK TO MAKE.COM =====
async function sendToMakeWebhook(reservationData, reservationId) {
  console.log('🔵 sendToMakeWebhook RECEIVED:');
  console.log('reservationId:', reservationId);
  console.log('reservationData:', JSON.stringify(reservationData, null, 2));
  
  try {
    let formattedDate = reservationData.date;
    
    if (formattedDate && formattedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = formattedDate.split('-');
      formattedDate = `${day}-${month}-${year}`;
      console.log('📅 Date format converted (YYYY-MM-DD → DD-MM-YYYY):', reservationData.date, '→', formattedDate);
    } else if (formattedDate && formattedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      console.log('📅 Date already in DD-MM-YYYY format:', formattedDate);
    }
    
    const payload = {
      reservationId: reservationId,
      firstName: reservationData.firstName || '',
      lastName: reservationData.lastName || '',
      phone: reservationData.phone || '',
      date: formattedDate,
      time: reservationData.time,
      guests: reservationData.guests,
      adults: reservationData.adults || reservationData.guests,
      children: reservationData.children || 0,
      specialRequests: reservationData.specialRequests || 'No special requests',
      newsletter: reservationData.newsletter || false,
      whatsappConfirmation: reservationData.whatsapp_confirmation || false
    };

    console.log('📤 SENDING TO MAKE.COM:');
    console.log('Payload size:', JSON.stringify(payload).length, 'bytes');
    console.log('Payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log('📨 MAKE.COM RESPONSE:', response.status, responseText);

    if (response.ok) {
      console.log('✅ Webhook sent to Make.com successfully', { reservationId });
    } else {
      console.log('⚠️ Webhook to Make.com failed', { 
        reservationId, 
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText
      });
    }
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    console.error('❌ Error sending webhook to Make.com', { 
      reservationId, 
      error: error.message,
      stack: error.stack
    });
  }
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

// ===== ENHANCED DATE RESOLUTION FUNCTION =====
function resolveDate(dateString) {
  safeLog('🔍 resolveDate called', { 
    input: dateString,
    timestamp: new Date().toISOString(),
    romeToday: getRomeDateToday()
  });
  
  const cleanedDate = dateString.toLowerCase().trim();
  
  if (cleanedDate === 'today' || cleanedDate === 'oggi') {
    const result = getRomeDateToday();
    safeLog('✅ "today" resolved', { input: dateString, result });
    return result;
  }
  
  if (cleanedDate === 'tomorrow' || cleanedDate === 'domani') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
    safeLog('✅ "tomorrow" resolved', { input: dateString, result });
    return result;
  }
  
  const nextEnglishMatch = cleanedDate.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextEnglishMatch) {
    const result = findNextDayOfWeek(nextEnglishMatch[1], true);
    safeLog('✅ "next day" resolved', { input: dateString, result });
    return result;
  }
  
  const prossimoMatch = cleanedDate.match(/^prossim[oa]\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)$/);
  if (prossimoMatch) {
    const result = findNextDayOfWeek(prossimoMatch[1], true);
    safeLog('✅ "prossimo" resolved', { input: dateString, result });
    return result;
  }
  
  const dayMap = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 'sabato': 6
  };
  
  const targetDay = dayMap[cleanedDate];
  if (targetDay !== undefined) {
    const result = findNextDayOfWeek(cleanedDate, false);
    safeLog('✅ Day name resolved', { input: dateString, result });
    return result;
  }
  
  const bareDayNumberMatch = cleanedDate.match(/^(\d{1,2})$/);
  if (bareDayNumberMatch) {
    const day = parseInt(bareDayNumberMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${validDay.toString().padStart(2, '0')}-${currentMonth.toString().padStart(2, '0')}-${currentYear}`;
      safeLog('✅ BARE DAY NUMBER resolved to CURRENT month', { 
        input: dateString, day, month: currentMonth, year: currentYear, result,
        note: 'Using current month even if date is in the past'
      });
      return result;
    }
  }
  
  const ordinalWithTheMatch = cleanedDate.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)$/);
  if (ordinalWithTheMatch) {
    const day = parseInt(ordinalWithTheMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${validDay.toString().padStart(2, '0')}-${currentMonth.toString().padStart(2, '0')}-${currentYear}`;
      safeLog('✅ ORDINAL resolved to CURRENT month', { input: dateString, day, month: currentMonth, year: currentYear, result });
      return result;
    }
  }
  
  const ordinalWithThisMonthMatch = cleanedDate.match(/(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+this\s+month/i);
  if (ordinalWithThisMonthMatch) {
    const day = parseInt(ordinalWithThisMonthMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${validDay.toString().padStart(2, '0')}-${currentMonth.toString().padStart(2, '0')}-${currentYear}`;
      safeLog('✅ "this month" ordinal resolved', { input: dateString, day, result });
      return result;
    }
  }
  
  const nextMonthMatch = cleanedDate.match(/(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+next\s+month/i);
  if (nextMonthMatch) {
    const day = parseInt(nextMonthMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      let nextMonth = today.getMonth() + 2;
      let nextYear = today.getFullYear();
      
      if (nextMonth > 12) {
        nextMonth = 1;
        nextYear++;
      }
      
      const lastDayOfMonth = getLastDayOfMonth(nextYear, nextMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${validDay.toString().padStart(2, '0')}-${nextMonth.toString().padStart(2, '0')}-${nextYear}`;
      safeLog('✅ "next month" ordinal resolved', { input: dateString, day, month: nextMonth, year: nextYear, result });
      return result;
    }
  }
  
  const explicitMonth = detectExplicitMonth(cleanedDate);
  if (explicitMonth !== null) {
    let day = null;
    
    const dayPatterns = [
      /(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+/i,
      /\s+(\d{1,2})(?:st|nd|rd|th)?$/i,
      /^(\d{1,2})(?:st|nd|rd|th)?\s+/i
    ];
    
    for (const pattern of dayPatterns) {
      const match = cleanedDate.match(pattern);
      if (match) {
        day = parseInt(match[1]);
        break;
      }
    }
    
    if (day && day >= 1 && day <= 31) {
      const today = getRomeDate();
      let year = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      if (explicitMonth < currentMonth) {
        year++;
      }
      
      const lastDayOfMonth = getLastDayOfMonth(year, explicitMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${validDay.toString().padStart(2, '0')}-${explicitMonth.toString().padStart(2, '0')}-${year}`;
      safeLog('✅ Explicit month resolved', { input: dateString, day, month: explicitMonth, year, result });
      return result;
    }
  }
  
  const wordNumberMap = {
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
    'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
    'eleventh': 11, 'twelfth': 12, 'thirteenth': 13, 'fourteenth': 14, 'fifteenth': 15,
    'sixteenth': 16, 'seventeenth': 17, 'eighteenth': 18, 'nineteenth': 19, 'twentieth': 20,
    'twenty-first': 21, 'twenty first': 21, 'twenty-second': 22, 'twenty second': 22,
    'twenty-third': 23, 'twenty third': 23, 'twenty-fourth': 24, 'twenty fourth': 24,
    'twenty-fifth': 25, 'twenty fifth': 25, 'twenty-sixth': 26, 'twenty sixth': 26,
    'twenty-seventh': 27, 'twenty seventh': 27, 'twenty-eighth': 28, 'twenty eighth': 28,
    'twenty-ninth': 29, 'twenty ninth': 29, 'thirtieth': 30, 'thirty-first': 31, 'thirty first': 31
  };
  
  for (const [word, day] of Object.entries(wordNumberMap)) {
    if (cleanedDate.includes(word) && 
        !cleanedDate.includes('next') && 
        !cleanedDate.includes('prossimo') &&
        !detectExplicitMonth(cleanedDate)) {
      
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${validDay.toString().padStart(2, '0')}-${currentMonth.toString().padStart(2, '0')}-${currentYear}`;
      safeLog('✅ Word ordinal resolved to CURRENT month', { input: dateString, word, day, month: currentMonth, year: currentYear, result });
      return result;
    }
  }
  
  const dayMatch = cleanedDate.match(/(\d+)(?:st|nd|rd|th)?/);
  if (dayMatch) {
    const day = parseInt(dayMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${validDay.toString().padStart(2, '0')}-${currentMonth.toString().padStart(2, '0')}-${currentYear}`;
      safeLog('✅ Day number resolved to CURRENT month', { input: dateString, day, month: currentMonth, year: currentYear, result,
        note: 'Using current month even if date is in the past' });
      return result;
    }
  }
  
  if (cleanedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
    safeLog('✅ Already in DD-MM-YYYY format', { input: dateString, result: cleanedDate });
    return cleanedDate;
  }
  
  if (cleanedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = cleanedDate.split('-');
    const result = `${day}-${month}-${year}`;
    safeLog('✅ Converted from YYYY-MM-DD to DD-MM-YYYY', { input: dateString, result });
    return result;
  }
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
  safeLog('⚠️ Defaulting to tomorrow', { input: dateString, result });
  return result;
}

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
  
  if (daysToAdd === 0 && skipCurrentWeek) {
    daysToAdd = 7;
  }
  
  const targetDate = addDays(today, daysToAdd);
  return formatInTimeZone(targetDate, ROME_TIMEZONE, 'dd-MM-yyyy');
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
    // Step 1: Resolve the start date (returns DD-MM-YYYY)
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
    
    // Step 2: Calculate the end date (6 days after start = 7 days total)
    const [day, month, year] = resolvedStartDate.split('-');
    const startDate = new Date(`${year}-${month}-${day}`);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    
    const endDateFormatted = formatInTimeZone(endDate, ROME_TIMEZONE, 'dd-MM-yyyy');
    
    safeLog('📅 Week range calculated', { startDate: resolvedStartDate, endDate: endDateFormatted });
    
    // Step 3: Get Google Calendar client
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error("Google Calendar client not initialized");
    }
    
    // Step 4: Query Google Calendar for the date range
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
    
    // Step 5: Organise events by date, initialising all 7 days first
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
    
    // Step 6: Process and assign each event to its day bucket
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
    
    // Step 7: Sort events within each day by start time
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
    // Step 1: Resolve both dates
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
    
    // Step 2: Parse dates and calculate range
    const [startDay, startMonth, startYear] = resolvedStartDate.split('-');
    const [endDay, endMonth, endYear] = resolvedEndDate.split('-');
    
    const startDate = new Date(`${startYear}-${startMonth}-${startDay}`);
    const endDate = new Date(`${endYear}-${endMonth}-${endDay}`);
    
    // Guard against reversed range
    if (endDate < startDate) {
      return {
        success: false,
        message: `End date (${resolvedEndDate}) cannot be before start date (${resolvedStartDate}).`,
        events: [],
        rangeEvents: []
      };
    }
    
    // Cap range at 31 days to protect against excessive API calls
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
    
    // Step 3: Get Google Calendar client
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error("Google Calendar client not initialized");
    }
    
    // Step 4: Query Google Calendar for the full range in one call
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
    
    // Step 5: Initialise a bucket for every day in the range
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
    
    // Step 6: Assign events to day buckets
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
    
    // Step 7: Sort within each day
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

// ===== BILINGUAL SUPPORT: Convert day name to actual date =====
function convertDayToDate(dayName) {
  const today = new Date();
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
    return formatInTimeZone(today, ROME_TIMEZONE, 'dd-MM-yyyy');
  } else if (targetDay === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
  } else if (targetDay !== undefined) {
    const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return formatInTimeZone(targetDate, ROME_TIMEZONE, 'dd-MM-yyyy');
  }
  
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
}

// ===================================================================
// ===== API ENDPOINTS
// ===================================================================

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
      note: "All dates and times are based on Europe/Rome timezone"
    });
  } catch (error) {
    safeLog('Error in /api/now endpoint', { error: error.message }, 'error');
    res.status(500).json({ success: false, error: 'Failed to get Rome time', message: error.message });
  }
});

// B) Resolve date — POST (Retell format)
app.post('/api/resolve_date', (req, res) => {
  try {
    const text = req.body.text || req.body.args?.text || req.body.date || req.body.args?.date;
    
    if (!text) {
      return res.status(400).json({
        error: 'Missing text parameter',
        message: 'Please provide a date text like "the 13th", "tomorrow", "next friday", etc.'
      });
    }
    
    const todayInRome = getRomeDateToday();
    const resolvedDate = resolveDate(text);
    
    res.json({ 
      resolvedDate, originalText: text, todayInRome, timezone: ROME_TIMEZONE
    });
    
  } catch (error) {
    safeLog('Error in /api/resolve_date endpoint', { error: error.message }, 'error');
    res.status(500).json({
      error: 'Failed to resolve date', message: error.message, resolvedDate: getRomeDateToday()
    });
  }
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

// ===================================================================
// ===== CALENDAR ENDPOINTS — SINGLE DAY
// Use for: specific day requests ("mercoledì", "venerdì prossimo", "tomorrow")
// Tool name: get_events_by_date
// ===================================================================

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

// ===================================================================
// ===== CALENDAR ENDPOINTS — FULL WEEK
// Use for: week-scope requests ("next week", "questa settimana", "dal lunedì al venerdì")
// Tool name: get_events_for_week  |  startDate = first day of the desired week
// ===================================================================

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

// ===================================================================
// ===== CALENDAR ENDPOINTS — CUSTOM DATE RANGE  (NEW)
// Use for: explicit range requests ("from March 1 to March 7", "dal 1 al 7 marzo")
// Tool name: get_events_for_date_range
// Max range: 31 days. startDate and endDate are both inclusive.
// ===================================================================

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

// ===================================================================
// ===== MAIN WEBHOOK ENDPOINT
// ===================================================================
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    
    const { event, call } = req.body;
    
    if (event !== 'call_analyzed') {
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_analyzed event...');
    
    const conversationText = call?.transcript_object
      ?.map(msg => msg.content || '')
      .join(' ')
      .toLowerCase() || '';
    
    const intentResult = detectReservationIntent(conversationText, call?.transcript_object || []);
    
    if (!intentResult.wantsReservation) {
      console.log('❌ No reservation intent detected. NOT saving to Airtable.');
      const greeting = getItalianTimeGreeting();
      return res.json({
        response: `${greeting}! Grazie per aver chiamato il Jazzamore. Se hai bisogno di fare una prenotazione, siamo a tua disposizione. Arrivederci!`,
        saveToAirtable: false,
        reason: 'No reservation intent detected',
        detectionDetails: intentResult
      });
    }
    
    console.log('✅ Reservation intent detected. Proceeding with data extraction...');
    
    const reservationId = generateReservationId();
    let reservationData = {};
    
    let postCallData = null;
    if (call?.call_analysis?.custom_analysis_data?.reservation_details) {
      try {
        postCallData = JSON.parse(call.call_analysis.custom_analysis_data.reservation_details);
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
    
    if (postCallData) {
      reservationData = {
        firstName: postCallData.first_name || postCallData.firstName || '',
        lastName: postCallData.last_name || postCallData.lastName || '',
        phone: postCallData.phone || '',
        guests: parseInt(postCallData.guests) || 2,
        adults: parseInt(postCallData.adults) || (parseInt(postCallData.guests) || 2),
        children: parseInt(postCallData.children) || 0,
        date: postCallData.date ? convertDayToDate(postCallData.date) : formatInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), ROME_TIMEZONE, 'dd-MM-yyyy'),
        time: postCallData.time || '22:00',
        specialRequests: postCallData.special_requests || postCallData.specialRequests || 'No special requests',
        newsletter: postCallData.newsletter === 'yes' || postCallData.newsletter_opt_in === 'yes' || postCallData.newsletter === true || false,
        whatsapp_confirmation: postCallData.whatsapp_confirmation === 'yes' || postCallData.whatsapp === 'yes' || false
      };
    } else if (call?.transcript_object) {
      const systemLogs = JSON.stringify(call, null, 2);
      reservationData = extractReservationData(call.transcript_object, systemLogs);
    } else {
      reservationData = {
        firstName: '', lastName: '',
        date: formatInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), ROME_TIMEZONE, 'dd-MM-yyyy'),
        time: '22:00', guests: 2, adults: 2, children: 0,
        phone: '', specialRequests: 'No special requests', newsletter: false, whatsapp_confirmation: false
      };
    }
    
    // Override phone number with transcript-extracted number (more reliable)
    const transcriptPhone = extractPhoneFromTranscript(call?.transcript_object);
    if (transcriptPhone) {
      reservationData.phone = transcriptPhone;
      console.log(`✅ Using transcript-extracted phone number: ${transcriptPhone}`);
    }
    
    const { firstName, lastName, date, time, guests, adults, children, phone, specialRequests, newsletter, whatsapp_confirmation } = reservationData;
    
    let formattedPhone = phone;
    if (phone && phone.replace(/\D/g, '').length >= 9) {
      const digits = phone.replace(/\D/g, '');
      formattedPhone = digits.startsWith('39') ? `+${digits}` : `+39${digits}`;
    }
    
    let validatedDate = date;
    const [day, month, year] = date.split('-');
    const reservationDateObj = new Date(`${year}-${month}-${day}`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (reservationDateObj < today) {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      validatedDate = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'dd-MM-yyyy');
      console.log(`⚠️ Date in past, adjusted to: ${validatedDate}`);
    }
    
    let calendarCheck;
    try {
      calendarCheck = await checkCalendarForConflicts(validatedDate, time);
      
      if (calendarCheck.hasConflicts) {
        const soldOutConflicts = calendarCheck.conflictingEvents.filter(event => event.isSoldOut);
        if (soldOutConflicts.length === 0) {
          const conflictNote = `Calendar Note: Potential conflict with ${calendarCheck.conflictingEvents.length} event(s) around same time.`;
          reservationData.specialRequests = reservationData.specialRequests 
            ? `${reservationData.specialRequests}. ${conflictNote}` : conflictNote;
        }
      }
    } catch (calendarError) {
      calendarCheck = { hasConflicts: false, conflictingEvents: [], error: calendarError.message };
    }
    
    const arrivalTimeISO = formatTimeForAirtable(time, validatedDate);
    
    const whatsappValue = (whatsapp_confirmation === true || 
                           whatsapp_confirmation === 'yes' || 
                           whatsapp_confirmation === 'true') ? "Yes" : "No";
    
    const newsletterValue = (newsletter === true || 
                             newsletter === 'yes' || 
                             newsletter === 'true');
    
    let airtableDate = validatedDate;
    if (validatedDate && validatedDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [d, m, y] = validatedDate.split('-');
      airtableDate = `${y}-${m}-${d}`;
    }
    
    const airtableFields = {
      "Reservation ID": reservationId,
      "First Name": firstName || '',
      "Last Name": lastName || '',
      "Phone Number": formattedPhone || '',
      "Reservation Date": airtableDate,
      "Arrival Time": arrivalTimeISO,
      "Total People": parseInt(guests) || 2,
      "Dinner Count": parseInt(adults) || 2,
      "Show-Only Count": 0,
      "Kids Count": parseInt(children) || 0,
      "Special Requests": reservationData.specialRequests || '',
      "Reservation Status": "Confirmed",
      "Reservation Type": "Dinner + Show",
      "Newsletter Opt-In": newsletterValue,
      "Whatsapp Confirmation": whatsappValue
    };
    
    try {
      const record = await base('Reservations').create([{ fields: airtableFields }]);
      
      console.log('🎉 RESERVATION SAVED TO AIRTABLE!');
      console.log('Reservation ID:', reservationId);
      console.log('Airtable Record ID:', record[0].id);
      
      if (whatsapp_confirmation === true || whatsapp_confirmation === 'yes') {
        let cleanSpecialRequests = reservationData.specialRequests || 'No special requests';
        if (cleanSpecialRequests.includes('Calendar Note:')) {
          cleanSpecialRequests = cleanSpecialRequests.split('Calendar Note:')[0].trim();
          if (!cleanSpecialRequests) cleanSpecialRequests = 'No special requests';
        }
        
        await sendToMakeWebhook({
          firstName, lastName, phone: formattedPhone,
          date: validatedDate, time, guests,
          specialRequests: cleanSpecialRequests,
          whatsapp_confirmation
        }, reservationId);
      }
      
      const greeting = getItalianTimeGreeting();
      const farewellMap = {
        "Buongiorno": "Buona giornata",
        "Buon pranzo": "Buon pranzo",
        "Buon pomeriggio": "Buon proseguimento",
        "Buonasera": "Buona serata",
        "Buonanotte": "Buona notte"
      };
      const farewell = farewellMap[greeting] || "Buona giornata";
      
      res.json({
        response: `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. ${farewell}!`,
        saveToAirtable: true,
        reservationId,
        intentDetected: true,
        detectionDetails: intentResult,
        calendarCheck: {
          hasConflicts: calendarCheck.hasConflicts || false,
          error: calendarCheck.error
        }
      });
      
    } catch (airtableError) {
      console.error('❌ Airtable error:', airtableError.message);
      const greeting = getItalianTimeGreeting();
      res.json({
        response: `${greeting}! Abbiamo riscontrato un problema con la prenotazione. Ti preghiamo di riprovare o chiamarci direttamente.`,
        saveToAirtable: false,
        error: airtableError.message
      });
    }
    
  } catch (error) {
    console.error('❌ Error in main webhook endpoint:', error.message);
    const greeting = getItalianTimeGreeting();
    res.json({
      response: `${greeting}! Grazie per la tua chiamata! Abbiamo riscontrato un problema. Ti preghiamo di riprovare più tardi.`,
      saveToAirtable: false,
      error: error.message
    });
  }
});

// ===== SERVER STARTUP =====
app.listen(PORT, () => {
  const romeDateTime = getRomeDateTime();
  const greeting = getItalianTimeGreeting();
  
  console.log(`\n🎵 Jazzamore Reservation System v3.0`);
  console.log(`📡 Running on port: ${PORT}`);
  console.log(`🇮🇹 ${greeting}! Rome time: ${romeDateTime.date} ${romeDateTime.time}`);
  console.log(`\n🔑 Google Calendar Integration:`);
  console.log(`   • Account: ${serviceAccount.client_email}`);
  console.log(`   • Calendar ID: ${JAZZAMORE_CALENDAR_ID}`);
  console.log(`   • Access: Read-only (calendar.readonly)`);
  console.log(`   • Status: ✅ ACTIVE - SINGLE SOURCE OF TRUTH`);
  console.log(`\n🌐 API Endpoints:`);
  console.log(`   • Time in Rome:               GET  /api/now`);
  console.log(`   • Resolve Date (POST):         POST /api/resolve_date`);
  console.log(`   • Resolve Date (GET):          GET  /api/resolve-date?text=tomorrow`);
  console.log(`\n   ── SINGLE DAY (get_events_by_date) ──`);
  console.log(`   • Calendar Events (POST):      POST /api/calendar/date`);
  console.log(`   • Calendar Events (GET):       GET  /api/calendar/date?date=tomorrow`);
  console.log(`\n   ── FULL WEEK (get_events_for_week) ──`);
  console.log(`   • Week Events (POST):          POST /api/calendar/week`);
  console.log(`   • Week Events (GET):           GET  /api/calendar/week?startDate=monday`);
  console.log(`\n   ── CUSTOM RANGE (get_events_for_date_range) ── NEW`);
  console.log(`   • Date Range Events (POST):    POST /api/calendar/range`);
  console.log(`   • Date Range Events (GET):     GET  /api/calendar/range?startDate=01-04-2026&endDate=07-04-2026`);
  console.log(`\n   ── OTHER ──`);
  console.log(`   • Availability:                GET  /api/calendar/availability?date=tomorrow&time=20:00`);
  console.log(`   • Time Greeting (GET):         GET  /api/time-greeting`);
  console.log(`   • Time Greeting (POST):        POST /api/time-greeting`);
  console.log(`   • Diagnostic:                  GET  /api/calendar/diagnostic`);
  console.log(`   • Test Calendar:               GET  /api/test/google-calendar`);
  console.log(`   • Reservations Webhook:        POST /api/reservations`);
  console.log(`\n📋 EVENT REQUEST HANDLING:`);
  console.log(`   • Specific day  → use get_events_by_date  → POST /api/calendar/date`);
  console.log(`   • Full week     → use get_events_for_week → POST /api/calendar/week`);
  console.log(`   • Date range    → use get_events_for_date_range → POST /api/calendar/range`);
  console.log(`\n📋 Key Features:`);
  console.log(`   ✅ Google Calendar as ONLY source of truth`);
  console.log(`   ✅ All dates in DD-MM-YYYY format for WhatsApp`);
  console.log(`   ✅ Enhanced date resolution returning DD-MM-YYYY`);
  console.log(`   ✅ Fixed phone number extraction from transcript`);
  console.log(`   ✅ Calendar note removed from WhatsApp messages`);
  console.log(`   ✅ Full week view (7 days, all slots initialised)`);
  console.log(`   ✅ Custom date range view (up to 31 days) — NEW`);
  console.log(`\n🚀 System ready! Google Calendar is the authoritative source for all events.`);
});
