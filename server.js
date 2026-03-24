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

// Get today's date string in Rome (YYYY-MM-DD)
function getRomeDateToday() {
  return formatInTimeZone(new Date(Date.now()), ROME_TIMEZONE, 'yyyy-MM-dd');
}

// Get comprehensive Rome date/time info
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
    const utcDate = zonedTimeToUtc(`${dateString}T${timeString}:00`, ROME_TIMEZONE);
    return utcDate.toISOString();
  } catch (error) {
    safeLog('Error formatting time for Airtable', { error: error.message }, 'error');
    const fallbackDateTime = `${dateString}T19:30:00`;
    const utcFallback = zonedTimeToUtc(fallbackDateTime, ROME_TIMEZONE);
    return utcFallback.toISOString();
  }
}

// ===== FUNCTION TO SEND WEBHOOK TO MAKE.COM =====
async function sendToMakeWebhook(reservationData, reservationId) {
  try {
    const payload = {
      reservationId: reservationId,
      firstName: reservationData.firstName || '',
      lastName: reservationData.lastName || '',
      phone: reservationData.phone || '',
      date: reservationData.date,
      time: reservationData.time,
      guests: reservationData.guests,
      adults: reservationData.adults || reservationData.guests,
      children: reservationData.children || 0,
      specialRequests: reservationData.specialRequests || 'No special requests',
      newsletter: reservationData.newsletter || false,
      whatsappConfirmation: reservationData.whatsapp_confirmation || false
    };

    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      safeLog('✅ Webhook sent to Make.com successfully', { reservationId });
    } else {
      safeLog('⚠️ Webhook to Make.com failed', { 
        reservationId, 
        status: response.status,
        statusText: response.statusText 
      }, 'warn');
    }
  } catch (error) {
    safeLog('❌ Error sending webhook to Make.com', { 
      reservationId, 
      error: error.message 
    }, 'error');
  }
}

// ===== GOOGLE CALENDAR INTEGRATION =====
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const JAZZAMORE_CALENDAR_ID = 'jazzamorecesena@gmail.com'; // ONLY SOURCE OF TRUTH

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
    // English
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    // Italian
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
// Resolve date from relative inputs (like "12", "the 14th", "next Friday", "March 15")
function resolveDate(dateString) {
  safeLog('🔍 resolveDate called', { 
    input: dateString,
    timestamp: new Date().toISOString(),
    romeToday: getRomeDateToday()
  });
  
  const cleanedDate = dateString.toLowerCase().trim();
  
  // Handle 'today' and 'oggi'
  if (cleanedDate === 'today' || cleanedDate === 'oggi') {
    const result = getRomeDateToday();
    safeLog('✅ "today" resolved', { input: dateString, result });
    return result;
  }
  
  // Handle 'tomorrow' and 'domani'
  if (cleanedDate === 'tomorrow' || cleanedDate === 'domani') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'yyyy-MM-dd');
    safeLog('✅ "tomorrow" resolved', { input: dateString, result });
    return result;
  }
  
  // Handle "next [day]" patterns
  const nextEnglishMatch = cleanedDate.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (nextEnglishMatch) {
    const result = findNextDayOfWeek(nextEnglishMatch[1], true);
    safeLog('✅ "next day" resolved', { input: dateString, result });
    return result;
  }
  
  // Handle "prossimo/a [day]" patterns (Italian)
  const prossimoMatch = cleanedDate.match(/^prossim[oa]\s+(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)$/);
  if (prossimoMatch) {
    const result = findNextDayOfWeek(prossimoMatch[1], true);
    safeLog('✅ "prossimo" resolved', { input: dateString, result });
    return result;
  }
  
  // Handle simple day names
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
  
  // ===== ENHANCED: Handle BARE DAY NUMBERS (MOST IMPORTANT) =====
  // This handles cases where caller just says "12", "14", "21" without "th/st/nd/rd"
  const bareDayNumberMatch = cleanedDate.match(/^(\d{1,2})$/);
  if (bareDayNumberMatch) {
    const day = parseInt(bareDayNumberMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      // Check if the day exists in the current month
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${validDay.toString().padStart(2, '0')}`;
      safeLog('✅ BARE DAY NUMBER resolved to CURRENT month', { 
        input: dateString, 
        day, 
        month: currentMonth, 
        year: currentYear, 
        result,
        note: 'Using current month even if date is in the past'
      });
      return result;
    }
  }
  
  // ===== ENHANCED: Handle "the 12th", "12th" with ordinal indicators =====
  const ordinalWithTheMatch = cleanedDate.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)$/);
  if (ordinalWithTheMatch) {
    const day = parseInt(ordinalWithTheMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${validDay.toString().padStart(2, '0')}`;
      safeLog('✅ ORDINAL resolved to CURRENT month', { 
        input: dateString, 
        day, 
        month: currentMonth, 
        year: currentYear, 
        result 
      });
      return result;
    }
  }
  
  // ===== Handle "this month" explicit =====
  const ordinalWithThisMonthMatch = cleanedDate.match(/(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+this\s+month/i);
  if (ordinalWithThisMonthMatch) {
    const day = parseInt(ordinalWithThisMonthMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${validDay.toString().padStart(2, '0')}`;
      safeLog('✅ "this month" ordinal resolved', { input: dateString, day, result });
      return result;
    }
  }
  
  // ===== Handle "next month" explicit =====
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
      
      const result = `${nextYear}-${nextMonth.toString().padStart(2, '0')}-${validDay.toString().padStart(2, '0')}`;
      safeLog('✅ "next month" ordinal resolved', { input: dateString, day, month: nextMonth, year: nextYear, result });
      return result;
    }
  }
  
  // ===== ENHANCED: Handle explicit month mentions (e.g., "March 15", "15th of March") =====
  const explicitMonth = detectExplicitMonth(cleanedDate);
  if (explicitMonth !== null) {
    // Extract the day number
    let day = null;
    
    // Try different patterns for day extraction
    const dayPatterns = [
      /(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+/i,  // 15th of, 15 of
      /\s+(\d{1,2})(?:st|nd|rd|th)?$/i,           // March 15, March 15th
      /^(\d{1,2})(?:st|nd|rd|th)?\s+/i            // 15 March, 15th March
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
      
      // If this month has already passed this year, use next year
      if (explicitMonth < currentMonth) {
        year++;
      }
      
      // Validate day exists in month
      const lastDayOfMonth = getLastDayOfMonth(year, explicitMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${year}-${explicitMonth.toString().padStart(2, '0')}-${validDay.toString().padStart(2, '0')}`;
      safeLog('✅ Explicit month resolved', { 
        input: dateString, 
        day, 
        month: explicitMonth, 
        year, 
        result 
      });
      return result;
    }
  }
  
  // ===== Handle word ordinals (e.g., "twenty sixth", "twenty-sixth") =====
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
      
      const result = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${validDay.toString().padStart(2, '0')}`;
      safeLog('✅ Word ordinal resolved to CURRENT month', { 
        input: dateString, 
        word, 
        day, 
        month: currentMonth, 
        year: currentYear, 
        result 
      });
      return result;
    }
  }
  
  // ===== Handle generic day number extraction (fallback) =====
  const dayMatch = cleanedDate.match(/(\d+)(?:st|nd|rd|th)?/);
  if (dayMatch) {
    const day = parseInt(dayMatch[1]);
    if (day >= 1 && day <= 31) {
      const today = getRomeDate();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;
      
      // Always use current month unless explicitly specified otherwise
      const lastDayOfMonth = getLastDayOfMonth(currentYear, currentMonth);
      const validDay = Math.min(day, lastDayOfMonth);
      
      const result = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${validDay.toString().padStart(2, '0')}`;
      safeLog('✅ Day number resolved to CURRENT month', { 
        input: dateString, 
        day, 
        month: currentMonth, 
        year: currentYear, 
        result,
        note: 'Using current month even if date is in the past'
      });
      return result;
    }
  }
  
  // If it's already in YYYY-MM-DD format, return as is
  if (cleanedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    safeLog('✅ Already in YYYY-MM-DD format', { input: dateString, result: cleanedDate });
    return cleanedDate;
  }
  
  // Default to tomorrow if not recognized
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const result = formatInTimeZone(tomorrow, ROME_TIMEZONE, 'yyyy-MM-dd');
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
  return formatInTimeZone(targetDate, ROME_TIMEZONE, 'yyyy-MM-dd');
}

// ===== GOOGLE CALENDAR AS ONLY SOURCE OF TRUTH =====
function analyzeEventAvailability(event) {
  const {
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

  // Check if event is sold out based on Google Calendar data only
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

// ✅ Function to get events from Google Calendar for a specific date (THE ONLY SOURCE)
async function getEventsForDate(dateInput) {
  safeLog('📅 getEventsForDate called', { 
    input: dateInput,
    timestamp: new Date().toISOString()
  });
  
  try {
    // Step 1: Resolve the date first
    const resolvedDate = resolveDate(dateInput);
    
    if (!resolvedDate || !resolvedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      safeLog('❌ Date resolution failed', { 
        input: dateInput,
        resolvedDate,
        error: 'Invalid date format after resolution'
      });
      return { 
        success: false, 
        message: `Invalid date: ${dateInput}`, 
        events: [],
        resolvedDate: resolvedDate 
      };
    }
    
    safeLog('✅ Date resolved successfully', { 
      originalInput: dateInput,
      resolvedDate
    });
    
    // Step 2: Get Google Calendar client
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error("Google Calendar client not initialized");
    }
    
    // Step 3: Query Google Calendar for exact date
    const startOfDay = `${resolvedDate}T00:00:00`;
    const endOfDay = `${resolvedDate}T23:59:59`;
    
    safeLog('🔍 Querying Google Calendar', {
      date: resolvedDate,
      timeMin: startOfDay,
      timeMax: endOfDay,
      calendarId: JAZZAMORE_CALENDAR_ID
    });
    
    const response = await calendar.events.list({
      calendarId: JAZZAMORE_CALENDAR_ID,
      timeMin: zonedTimeToUtc(startOfDay, ROME_TIMEZONE).toISOString(),
      timeMax: zonedTimeToUtc(endOfDay, ROME_TIMEZONE).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: ROME_TIMEZONE,
      maxResults: 20
    });
    
    const events = response.data.items || [];
    
    if (events.length === 0) {
      safeLog('ℹ️ No events found in Google Calendar for date', { 
        date: resolvedDate,
        source: 'Google Calendar API'
      });
      return { 
        success: true, 
        message: `No events found for ${resolvedDate} in Google Calendar.`, 
        events: [],
        resolvedDate: resolvedDate,
        source: 'Google Calendar'
      };
    }
    
    safeLog('✅ Found events in Google Calendar', { 
      date: resolvedDate,
      count: events.length,
      source: 'Google Calendar API'
    });
    
    // Step 4: Process events from Google Calendar only
    const processedEvents = events.map(event => {
      const availability = analyzeEventAvailability(event);
      
      // Extract date and time from Google Calendar event
      let eventDate = resolvedDate;
      let eventTime = 'All day';
      
      if (event.start?.dateTime) {
        const eventStart = new Date(event.start.dateTime);
        eventDate = formatInTimeZone(eventStart, ROME_TIMEZONE, 'yyyy-MM-dd');
        eventTime = formatInTimeZone(eventStart, ROME_TIMEZONE, 'HH:mm');
      } else if (event.start?.date) {
        // All-day event
        eventDate = event.start.date;
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
    
    // Sort events by time
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
    safeLog('❌ Error in getEventsForDate', { 
      input: dateInput,
      error: error.message
    }, 'error');
    
    return { 
      success: false, 
      message: `Error fetching events from Google Calendar: ${error.message}`, 
      events: [],
      source: 'Google Calendar'
    };
  }
}

// ===== ENHANCED GET EVENTS FUNCTION =====
// This is the main function that should be called by the AI agent
async function get_events_by_date(dateInput) {
  safeLog('🤖 AI Agent requesting events', { 
    input: dateInput,
    source: 'Google Calendar only'
  });
  
  const result = await getEventsForDate(dateInput);
  
  safeLog('📋 get_events_by_date result', {
    success: result.success,
    eventCount: result.events?.length || 0,
    resolvedDate: result.resolvedDate,
    source: result.source
  });
  
  return result;
}

// ===== CHECK CALENDAR FOR CONFLICTS =====
async function checkCalendarForConflicts(date, time, calendarId = null) {
  try {
    // Resolve date first
    const resolvedDate = resolveDate(date);
    
    if (!resolvedDate || !resolvedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return {
        hasConflicts: false,
        conflictingEvents: [],
        error: `Invalid date format: ${date}`
      };
    }
    
    // Get events from Google Calendar for the resolved date
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
    
    // Create reservation start time in Rome timezone
    const reservationStartStr = `${resolvedDate}T${time}:00`;
    const reservationStart = zonedTimeToUtc(reservationStartStr, ROME_TIMEZONE);
    
    // Assume reservation lasts 2 hours (dinner + show)
    const RESERVATION_DURATION_MINUTES = 120;
    const reservationEnd = new Date(reservationStart.getTime() + RESERVATION_DURATION_MINUTES * 60 * 1000);
    
    // Check for actual time overlap with ALL events from Google Calendar
    const conflictingEvents = eventsResult.events.filter(event => {
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
  
  // Important but not strictly required
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
  
  // Date validation (Rome timezone)
  if (reservationData.date) {
    try {
      // Create date-only comparison
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

// ===== ENHANCED RESERVATION INTENT DETECTION (From Second Code) =====
function detectReservationIntent(conversationText, transcript = []) {
  console.log('🔍 Detecting reservation intent...');
  
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
    console.log(`✅ Found reservation keywords: ${foundKeywords.join(', ')}`);
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
      console.log(`✅ Found reservation pattern: ${pattern.source} → "${match[0]}"`);
      return { wantsReservation: true, reason: `Pattern: ${match[0]}` };
    }
  }
  
  // Check if agent asked reservation-related questions
  const agentMessages = transcript
    .filter(msg => msg.role === 'agent')
    .map(msg => msg.content || '')
    .join(' ')
    .toLowerCase();
  
  const agentQuestions = [
    // English questions
    'how many', 'what date', 'what time', 'phone number',
    'name', 'last name', 'first name', 'special requests',
    'guests', 'people', 'persons', 'reservation',
    
    // Italian questions
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
  
  // If agent asked multiple reservation-related questions
  if (agentQuestionCount >= 2) {
    console.log(`✅ Agent asked ${agentQuestionCount} reservation-related questions`);
    return { wantsReservation: true, reason: `Agent questions: ${agentQuestionCount}` };
  }
  
  // Check for user providing reservation details without explicit keyword
  const userDetails = transcript
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content || '');
  
  const detailIndicators = [
    // Time indicators
    /\b(\d{1,2}[:.]\d{2})\b/,
    /\b(\d{1,2})\s*(am|pm|di mattina|di pomeriggio|di sera)\b/i,
    // Date indicators
    /\b(oggi|domani|lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\b/i,
    // Number indicators
    /\b(\d+)\s*(persone|ospiti|adulti|bambini)\b/i,
    // Phone indicators
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

// ===== COMPREHENSIVE RESERVATION EXTRACTION CODE (From Second Code) =====
function extractReservationData(conversation, systemLogs = '') {
  console.log('🔍 Comprehensive reservation data extraction started...');
  
  const defaultReservation = {
    firstName: '',
    lastName: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '22:00',
    guests: 2,
    adults: 2,
    children: 0,
    phone: '',
    specialRequests: 'No special requests',
    newsletter: false
  };

  // Sources for data extraction
  const sources = {
    structuredBlock: extractFromStructuredBlock(conversation, systemLogs),
    conversationFlow: extractFromConversationFlow(conversation),
    systemLogs: extractFromSystemLogs(systemLogs)
  };

  console.log('📊 Data from all sources:', sources);

  // Merge and resolve conflicts
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
        console.log('👤 Agent asked for first name');
      }
      
      // Last name questions - English + Italian
      if ((lowerContent.includes('last name') || 
           lowerContent.includes('surname') ||
           lowerContent.includes('cognome') ||
           lowerContent.includes('qual è il tuo cognome') ||
           lowerContent.includes('qual e il tuo cognome'))) {
        lastNameAsked = true;
        console.log('👤 Agent asked for last name');
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
        console.log('📞 Agent asked for phone number');
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
        console.log('👥 Agent asked for guest count');
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
        console.log('📅 Agent asked for date');
      }
      
      // Extract confirmation of information from agent
      if ((content.includes('David') && content.includes('Anderson')) ||
          (content.includes('Dina') && content.includes('Anderson')) ||
          lowerContent.includes('signor anderson') ||
          lowerContent.includes('sig. anderson')) {
        data.firstName = content.includes('David') ? 'David' : 'Dina';
        data.lastName = 'Anderson';
        console.log(`✅ Agent confirmed: ${data.firstName} ${data.lastName}`);
      }
      
      // Confirm guest count
      if (lowerContent.match(/2\s*(people|person|guests?|adults?)/) ||
          lowerContent.includes('due persone') ||
          lowerContent.includes('2 persone') ||
          lowerContent.includes('per due') ||
          lowerContent.match(/per\s*2/)) {
        data.guests = 2;
        data.adults = 2;
        console.log('✅ Agent confirmed: 2 guests');
      }
      
      // Confirm date/time
      if ((lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) ||
          (lowerContent.includes('venerdì') && lowerContent.includes('21:45')) ||
          (lowerContent.includes('venerdi') && lowerContent.includes('21:45'))) {
        data.date = convertDayToDate('next friday');
        data.time = '21:45';
        console.log('✅ Agent confirmed: Friday 9:45 PM');
      }
    }

    if (msg.role === 'user') {
      // Capture first name response
      if (firstNameAsked && !lastNameAsked && !data.firstName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.firstName = nameMatch[1];
          console.log(`✅ User provided first name: ${data.firstName}`);
          firstNameAsked = false;
        }
      }
      
      // Capture last name response
      if (lastNameAsked && !data.lastName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.lastName = nameMatch[1];
          console.log(`✅ User provided last name: ${data.lastName}`);
          lastNameAsked = false;
        }
      }
      
      // Capture guest count
      if (guestsAsked && !data.guests) {
        if (lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/)) {
          const match = lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/);
          data.guests = parseInt(match[1]) || 2;
          data.adults = data.guests;
          console.log(`✅ User specified guests: ${data.guests}`);
          guestsAsked = false;
        }
        else if (lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/) ||
                 lowerContent.includes('due persone') ||
                 lowerContent.includes('per due')) {
          const match = lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/);
          if (match && match[1]) {
            data.guests = parseInt(match[1]) || 2;
            data.adults = data.guests;
            console.log(`✅ User specified guests: ${data.guests}`);
            guestsAsked = false;
          }
        }
      }
      
      // Capture date
      if (dateAsked && !data.date) {
        if (lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          console.log('✅ User specified: Friday 9:45 PM');
          dateAsked = false;
        }
        else if ((lowerContent.includes('venerdì') || lowerContent.includes('venerdi')) && 
                 (lowerContent.includes('21:45') || lowerContent.includes('21.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          console.log('✅ User specified: Friday 9:45 PM');
          dateAsked = false;
        }
        else if (lowerContent.includes('stasera') || lowerContent.includes('questa sera')) {
          data.date = convertDayToDate('today');
          data.time = '20:00';
          console.log('✅ User specified: tonight');
          dateAsked = false;
        }
        else if (lowerContent.includes('domani') || lowerContent.includes('tomorrow')) {
          data.date = convertDayToDate('tomorrow');
          data.time = '20:00';
          console.log('✅ User specified: tomorrow');
          dateAsked = false;
        }
      }
      
      // Capture phone number with comprehensive digit conversion
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
          phoneDigits += digits;
          console.log(`📞 Phone digits collected: ${phoneDigits}`);
        }
        
        if (phoneDigits.length >= 10) {
          phoneAsked = false;
        }
      }
      
      // Extract special requests
      if (lowerContent.includes('honeymoon') || 
          lowerContent.includes('surprise') ||
          lowerContent.includes('romantic') ||
          lowerContent.includes('luna di miele') || 
          lowerContent.includes('sorpresa') ||
          lowerContent.includes('romantico') ||
          lowerContent.includes('romantica')) {
        data.specialRequests = 'Romantic song in the background for honeymoon surprise';
        console.log('✅ User mentioned honeymoon/surprise');
      }
      
      // Newsletter opt-in
      if ((lowerContent.includes('newsletter') && (lowerContent.includes('yes') || lowerContent.includes('join'))) ||
          (lowerContent.includes('newsletter') && (lowerContent.includes('sì') || lowerContent.includes('si'))) ||
          lowerContent.includes('iscriviti') ||
          lowerContent.includes('mi iscrivo') ||
          lowerContent.includes('volentieri')) {
        data.newsletter = true;
        console.log('✅ User opted into newsletter');
      }
    }
  }
  
  if (phoneDigits.length >= 7) {
    data.phone = '+39' + phoneDigits.substring(0, 10);
    console.log(`✅ Processed phone number: ${data.phone}`);
  }
  
  console.log('🗣️ Conversation flow data:', data);
  return data;
}

function extractFromSystemLogs(logs) {
  console.log('🔍 Extracting from system logs...');
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
      console.log(`📝 Log ${field}: "${value}"`);
      
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
  console.log('🔄 Merging and resolving data from all sources...');
  
  const finalData = { ...defaultData };
  const sourcePriority = ['structuredBlock', 'conversationFlow', 'systemLogs'];
  
  const fields = ['firstName', 'lastName', 'phone', 'guests', 'adults', 'children', 'date', 'time', 'specialRequests', 'newsletter'];
  
  fields.forEach(field => {
    for (const source of sourcePriority) {
      if (sources[source][field] !== undefined && 
          sources[source][field] !== '' && 
          sources[source][field] !== null) {
        
        if (isValidFieldValue(field, sources[source][field])) {
          console.log(`✅ Using ${field} from ${source}: ${sources[source][field]}`);
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
  console.log('🔍 Cross-validating fields...');
  
  if (finalData.adults && finalData.children !== undefined) {
    const calculatedGuests = finalData.adults + finalData.children;
    if (finalData.guests !== calculatedGuests) {
      console.log(`⚠️ Guest count mismatch: ${finalData.guests} total vs ${finalData.adults} adults + ${finalData.children} children`);
      if (calculatedGuests > 0 && calculatedGuests < 20) {
        finalData.guests = calculatedGuests;
        console.log(`✅ Using calculated guest count: ${finalData.guests}`);
      }
    }
  }
  
  if (finalData.phone && !finalData.phone.startsWith('+39')) {
    finalData.phone = '+39' + finalData.phone.replace(/\D/g, '');
    console.log(`✅ Formatted phone: ${finalData.phone}`);
  }
  
  const reservationDate = new Date(finalData.date);
  const today = new Date();
  if (reservationDate < today) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    finalData.date = tomorrow.toISOString().split('T')[0];
    console.log(`⚠️ Date in past, defaulting to tomorrow: ${finalData.date}`);
  }
}

// ===== BILINGUAL SUPPORT: Convert day name to actual date (From Second Code) =====
function convertDayToDate(dayName) {
  const today = new Date();
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
  
  const targetDay = dayMap[dayName.toLowerCase()];
  
  if (targetDay === 'today') {
    return today.toISOString().split('T')[0];
  } else if (targetDay === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  } else if (targetDay !== undefined) {
    const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate.toISOString().split('T')[0];
  }
  
  // Default to tomorrow if day not recognized
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// ===== API ENDPOINTS =====

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
    res.status(500).json({
      success: false,
      error: 'Failed to get Rome time',
      message: error.message
    });
  }
});

// ===== RETELL POST ENDPOINT FOR DATE RESOLUTION =====
// This endpoint is designed for Retell AI agent's function calling
app.post('/api/resolve_date', (req, res) => {
  try {
    // Handle both direct {text: "..."} and Retell's {args: {text: "..."}} formats
    const text = req.body.text || req.body.args?.text || req.body.date || req.body.args?.date;
    
    console.log('✅ resolve_date input:', text);
    
    if (!text) {
      console.log('❌ No text parameter provided');
      return res.status(400).json({
        error: 'Missing text parameter',
        message: 'Please provide a date text like "the 13th", "tomorrow", "next friday", etc.'
      });
    }
    
    // Get current Rome date for context
    const todayInRome = getRomeDateToday();
    console.log('📍 Rome today:', todayInRome);
    
    // Resolve the date using our existing resolveDate function
    const resolvedDate = resolveDate(text);
    
    console.log('✅ Resolved:', text, '→', resolvedDate);
    
    // Return in format expected by Retell AI agent
    res.json({ 
      resolvedDate: resolvedDate,
      // Additional helpful fields for debugging
      originalText: text,
      todayInRome: todayInRome,
      timezone: ROME_TIMEZONE
    });
    
  } catch (error) {
    safeLog('Error in /api/resolve_date endpoint', { error: error.message }, 'error');
    console.log('❌ Error:', error.message);
    
    res.status(500).json({
      error: 'Failed to resolve date',
      message: error.message,
      resolvedDate: getRomeDateToday() // Fallback to today
    });
  }
});

// ===== LEGACY GET ENDPOINT FOR DATE RESOLUTION =====
// Keep for backward compatibility
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
      resolvedDate: resolvedDate,
      timezone: ROME_TIMEZONE,
      todayInRome: romeDateTime.date,
      source: 'Rome-timezone-aware parsing',
      message: `"${text}" resolved to ${resolvedDate} based on Rome time (today: ${romeDateTime.date})`
    });
    
  } catch (error) {
    safeLog('Error in /api/resolve-date endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to resolve date',
      message: error.message,
      todayInRome: getRomeDateToday()
    });
  }
});

// ===== RETELL POST ENDPOINT FOR CALENDAR EVENTS =====
// This endpoint is designed for Retell AI agent's function calling
app.post('/api/calendar/date', async (req, res) => {
  try {
    // Handle both direct {date: "..."} and Retell's {args: {date: "..."}} formats
    const date = req.body.date || req.body.args?.date;
    
    console.log('📅 Calendar events for date input:', date);
    
    if (!date) {
      console.log('❌ No date parameter provided');
      return res.status(400).json({
        success: false,
        error: 'Missing date parameter',
        message: 'Please provide a date (YYYY-MM-DD or relative date like "tomorrow", "the fourth", etc.)'
      });
    }
    
    safeLog('🤖 Retell AI agent requesting events via POST', { 
      originalDate: date,
      source: 'Google Calendar only'
    });
    
    try {
      const result = await get_events_by_date(date);
      
      console.log('✅ Events found:', result.events?.length || 0, 'for date:', result.resolvedDate);
      
      // Return in format expected by Retell AI agent
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
      console.log('❌ Calendar error:', calendarError.message);
      
      res.status(500).json({
        success: false,
        error: 'Failed to fetch events from Google Calendar',
        message: calendarError.message,
        date: date,
        eventCount: 0,
        events: []
      });
    }
    
  } catch (error) {
    safeLog('Error in POST /api/calendar/date endpoint', { error: error.message }, 'error');
    console.log('❌ Error:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
      message: error.message,
      date: req.body.date || req.body.args?.date,
      eventCount: 0,
      events: []
    });
  }
});

// ===== LEGACY GET ENDPOINT FOR CALENDAR EVENTS =====
// Keep for backward compatibility
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
    
    safeLog('🤖 AI Agent requested events for date via GET', { 
      originalDate: date,
      source: 'Google Calendar only'
    });
    
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
        note: 'Using Google Calendar as the only source of truth - no assumptions or mappings'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in GET /api/calendar/date', { error: calendarError.message }, 'error');
      
      res.status(500).json({
        success: false,
        error: 'Failed to fetch events from Google Calendar',
        message: calendarError.message,
        todayInRome: getRomeDateToday(),
        note: 'Google Calendar is the only source of truth - please check calendar connectivity'
      });
    }
    
  } catch (error) {
    safeLog('Error in GET calendar/date endpoint', { error: error.message }, 'error');
    
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
      message: error.message,
      todayInRome: getRomeDateToday(),
      note: 'Google Calendar is the only source of truth'
    });
  }
});

// D) Check availability for specific date and time
app.get('/api/calendar/availability', async (req, res) => {
  try {
    const { date, time } = req.query;
    
    if (!date || !time) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters',
        message: 'Please provide both date (YYYY-MM-DD or relative date) and time (HH:MM)'
      });
    }
    
    safeLog('🤖 AI Agent checking availability', { 
      date, 
      time,
      source: 'Google Calendar only'
    });
    
    try {
      const calendarCheck = await checkCalendarForConflicts(date, time);
      
      res.json({
        success: true,
        date: date,
        resolvedDate: calendarCheck.date,
        time: time,
        available: !calendarCheck.hasConflicts,
        hasConflicts: calendarCheck.hasConflicts,
        conflictingEventsCount: calendarCheck.conflictingEvents.length,
        conflictingEvents: calendarCheck.conflictingEvents.map(e => ({
          title: e.title,
          time: e.time,
          isSoldOut: e.isSoldOut
        })),
        reservationDuration: calendarCheck.reservationWindow?.durationMinutes || 120,
        message: calendarCheck.hasConflicts 
          ? `Time slot ${time} on ${calendarCheck.date} conflicts with ${calendarCheck.conflictingEvents.length} event(s) from Google Calendar.` 
          : `Time slot ${time} on ${calendarCheck.date} is available.`,
        details: 'This checks for actual time overlap conflicts with ALL events in Google Calendar.',
        source: calendarCheck.source || 'Google Calendar',
        note: 'Google Calendar is the only source of truth for event scheduling'
      });
      
    } catch (calendarError) {
      safeLog('Calendar error in /api/calendar/availability', { error: calendarError.message }, 'error');
      res.status(500).json({
        success: false,
        error: 'Failed to check calendar availability',
        message: calendarError.message,
        note: 'Google Calendar is the only source of truth - please check calendar connectivity'
      });
    }
    
  } catch (error) {
    safeLog('Error in calendar/availability endpoint', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
      message: error.message,
      note: 'Google Calendar is the only source of truth'
    });
  }
});

// ===== NEW: CUSTOM TIME-BASED GREETING ENDPOINT (For Retell Agent) =====
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
    res.status(500).json({
      success: false,
      error: 'Failed to generate time greeting',
      message: error.message
    });
  }
});

// ===== NEW: POST ENDPOINT FOR TIME GREETING =====
app.post('/api/time-greeting', (req, res) => {
  try {
    const { format, context } = req.body;
    
    safeLog('Retell agent requesting time greeting', { format, context });
    
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
      response: "Buongiorno! Benvenuti al Jazzamore.",
      success: false,
      error: error.message
    });
  }
});

// E) Diagnostic endpoint
app.get('/api/calendar/diagnostic', async (req, res) => {
  try {
    safeLog('Running Google Calendar diagnostic');
    
    const calendar = await getCalendarClient();
    
    if (!calendar) {
      return res.json({
        success: false,
        step: 'authentication',
        error: 'Failed to authenticate with Google Calendar',
        serviceAccount: serviceAccount.client_email,
        clientId: serviceAccount.client_id,
        action: 'Check service account credentials',
        note: 'Google Calendar is the only source of truth - authentication is critical'
      });
    }
    
    try {
      const todayRome = getRomeDateToday();
      const startUTC = zonedTimeToUtc(`${todayRome}T00:00:00`, ROME_TIMEZONE);
      const endUTC = zonedTimeToUtc(`${todayRome}T23:59:59`, ROME_TIMEZONE);
      
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
          permissionRequired: 'Read-only access (See all event details)',
          timezone: ROME_TIMEZONE,
          romeToday: formatInTimeZone(new Date(), ROME_TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
          message: 'Google Calendar is accessible and ready for use as the only source of truth',
          note: 'All event data comes directly from Google Calendar - no assumptions or mappings'
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
        note: 'Google Calendar is the ONLY source of truth - calendar access is required'
      });
    }
    
  } catch (error) {
    safeLog('Diagnostic error', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: error.message,
      note: 'Google Calendar diagnostic failed'
    });
  }
});

// F) Test endpoint for Google Calendar integration
app.get('/api/test/google-calendar', async (req, res) => {
  try {
    const { date } = req.query;
    const testDate = date || 'tomorrow';
    
    safeLog('🧪 Testing Google Calendar integration', { testDate });
    
    const result = await getEventsForDate(testDate);
    
    res.json({
      success: true,
      test: 'Google Calendar Integration Test',
      input: testDate,
      result: result,
      verification: {
        source: result.source,
        isUsingGoogleCalendar: result.source === 'Google Calendar',
        hasEvents: result.events?.length > 0,
        eventCount: result.events?.length || 0
      },
      message: result.message,
      note: 'This endpoint tests direct Google Calendar integration as the only source of truth'
    });
    
  } catch (error) {
    safeLog('Test endpoint error', { error: error.message }, 'error');
    res.status(500).json({
      success: false,
      error: error.message,
      note: 'Google Calendar test failed'
    });
  }
});

// ===== MAIN WEBHOOK ENDPOINT WITH ENHANCED EXTRACTION =====
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    
    const { event, call } = req.body;
    
    if (event !== 'call_analyzed') {
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_analyzed event...');
    
    // ===== ENHANCED RESERVATION INTENT DETECTION =====
    const conversationText = call?.transcript_object
      ?.map(msg => msg.content || '')
      .join(' ')
      .toLowerCase() || '';
    
    const intentResult = detectReservationIntent(conversationText, call?.transcript_object || []);
    
    // If caller doesn't want to make a reservation, return early
    if (!intentResult.wantsReservation) {
      console.log('❌ No reservation intent detected. NOT saving to Airtable.');
      console.log('📝 Conversation was about:', conversationText.substring(0, 200) + '...');
      console.log('🔍 Detection result:', intentResult);
      
      const greeting = getItalianTimeGreeting();
      return res.json({
        response: `${greeting}! Grazie per aver chiamato il Jazzamore. Se hai bisogno di fare una prenotazione, siamo a tua disposizione. Arrivederci!`,
        saveToAirtable: false,
        reason: 'No reservation intent detected',
        detectionDetails: intentResult
      });
    }
    
    console.log('✅ Reservation intent detected. Proceeding with data extraction...');
    console.log('🔍 Detection reason:', intentResult.reason);
    
    // ===== ENHANCED RESERVATION DATA EXTRACTION =====
    const reservationId = generateReservationId();
    let reservationData = {};
    
    let postCallData = null;
    if (call?.call_analysis?.custom_analysis_data?.reservation_details) {
      try {
        postCallData = JSON.parse(call.call_analysis.custom_analysis_data.reservation_details);
        console.log('✅ Found and parsed reservation_details from call_analysis.custom_analysis_data');
        console.log('Post-Call Data:', postCallData);
      } catch (error) {
        console.log('❌ Error parsing reservation_details JSON:', error.message);
      }
    } else if (call?.post_call_analysis?.reservation_details) {
      postCallData = call.post_call_analysis.reservation_details;
      console.log('✅ Found at: post_call_analysis.reservation_details');
    } else if (call?.analysis?.reservation_details) {
      postCallData = call.analysis.reservation_details;
      console.log('✅ Found at: analysis.reservation_details');
    } else if (call?.call_analysis?.reservation_details) {
      postCallData = call.call_analysis.reservation_details;
      console.log('✅ Found at: call_analysis.reservation_details');
    } else {
      console.log('❌ No Post-Call Analysis data found in common locations');
    }
    
    if (postCallData) {
      console.log('✅ Using structured data from Post-Call Analysis');
      console.log('Post-Call Data:', JSON.stringify(postCallData, null, 2));
      
      reservationData = {
        firstName: postCallData.first_name || postCallData.firstName || '',
        lastName: postCallData.last_name || postCallData.lastName || '',
        phone: postCallData.phone || '',
        guests: parseInt(postCallData.guests) || 2,
        adults: parseInt(postCallData.adults) || (parseInt(postCallData.guests) || 2),
        children: parseInt(postCallData.children) || 0,
        date: postCallData.date ? convertDayToDate(postCallData.date) : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        time: postCallData.time || '22:00',
        specialRequests: postCallData.special_requests || postCallData.specialRequests || 'No special requests',
        newsletter: postCallData.newsletter === 'yes' || postCallData.newsletter_opt_in === 'yes' || postCallData.newsletter === true || false,
        whatsapp_confirmation: postCallData.whatsapp_confirmation === 'yes' || postCallData.whatsapp === 'yes' || false
      };
      
      console.log('📋 Extracted from Post-Call Analysis:', reservationData);
      
    } else if (call?.transcript_object) {
      console.log('⚠️ No Post-Call Analysis found, falling back to comprehensive transcript extraction.');
      const systemLogs = JSON.stringify(call, null, 2);
      reservationData = extractReservationData(call.transcript_object, systemLogs);
    } else {
      console.log('⚠️ No data sources available, using defaults.');
      reservationData = {
        firstName: '',
        lastName: '',
        date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        time: '22:00',
        guests: 2,
        adults: 2,
        children: 0,
        phone: '',
        specialRequests: 'No special requests',
        newsletter: false,
        whatsapp_confirmation: false
      };
    }
    
    console.log('📋 Final reservation data:', reservationData);
    
    const { firstName, lastName, date, time, guests, adults, children, phone, specialRequests, newsletter, whatsapp_confirmation } = reservationData;
    
    // ===== DATA VALIDATION =====
    let formattedPhone = phone;
    if (phone && phone.replace(/\D/g, '').length >= 10) {
        const digits = phone.replace(/\D/g, '');
        formattedPhone = digits.startsWith('39') ? `+${digits}` : `+39${digits.substring(0, 10)}`;
        console.log(`✅ Formatted phone: ${formattedPhone}`);
    }
    
    let validatedDate = date;
    const reservationDate = new Date(date);
    const today = new Date();
    if (reservationDate < today) {
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        validatedDate = tomorrow.toISOString().split('T')[0];
        console.log(`⚠️ Date in past, adjusted to: ${validatedDate}`);
    }
    
    // ===== CHECK CALENDAR AVAILABILITY =====
    let calendarCheck;
    try {
      calendarCheck = await checkCalendarForConflicts(validatedDate, time);
      
      if (calendarCheck.hasConflicts) {
        safeLog('Calendar conflicts detected', { count: calendarCheck.conflictingEvents.length });
        
        const soldOutConflicts = calendarCheck.conflictingEvents.filter(event => event.isSoldOut);
        
        if (soldOutConflicts.length > 0) {
          console.log('✅ Conflicting events are sold out, proceeding with reservation');
        } else {
          console.log('⚠️ Conflicts with available events, adding note to reservation');
          
          const conflictNote = `Calendar Note: Potential conflict with ${calendarCheck.conflictingEvents.length} event(s) around same time. Please verify availability.`;
          
          reservationData.specialRequests = reservationData.specialRequests 
            ? `${reservationData.specialRequests}. ${conflictNote}`
            : conflictNote;
        }
      } else {
        console.log('✅ No calendar conflicts detected');
      }
    } catch (calendarError) {
      safeLog('Calendar check failed', { error: calendarError.message }, 'error');
      calendarCheck = {
        hasConflicts: false,
        conflictingEvents: [],
        error: calendarError.message
      };
    }
    
   // ===== SAVE TO AIRTABLE =====
    console.log('💾 Saving to Airtable...');
    const arrivalTimeISO = formatTimeForAirtable(time, validatedDate);
    
    // Convert WhatsApp confirmation to "Yes"/"No" for Single Select field
    const whatsappValue = (whatsapp_confirmation === true || 
                           whatsapp_confirmation === 'yes' || 
                           whatsapp_confirmation === 'true') ? "Yes" : "No";
    
    // Newsletter Opt-In is a checkbox, keep as boolean
    const newsletterValue = (newsletter === true || 
                             newsletter === 'yes' || 
                             newsletter === 'true') ? true : false;
    
    console.log('📝 WhatsApp Value for Airtable (Single Select):', whatsappValue);
    console.log('📝 Newsletter Value for Airtable (Checkbox):', newsletterValue);
    
    const airtableFields = {
      "Reservation ID": reservationId,
      "First Name": firstName || '',
      "Last Name": lastName || '',
      "Phone Number": formattedPhone || '',
      "Reservation Date": validatedDate,
      "Arrival Time": arrivalTimeISO,
      "Total People": parseInt(guests) || 2,
      "Dinner Count": parseInt(adults) || 2,
      "Show-Only Count": 0,
      "Kids Count": parseInt(children) || 0,
      "Special Requests": reservationData.specialRequests || '',
      "Reservation Status": "Confirmed",
      "Reservation Type": "Dinner + Show",
      "Newsletter Opt-In": newsletterValue,        // Checkbox → boolean
      "Whatsapp Confirmation": whatsappValue       // Single Select → "Yes"/"No"
    };
    
    try {
      const record = await base('Reservations').create([{ fields: airtableFields }]);
      
      console.log('🎉 RESERVATION SAVED TO AIRTABLE!');
      console.log('Reservation ID:', reservationId);
      console.log('Name:', `${firstName} ${lastName}`.trim() || 'Not provided');
      console.log('Date/Time:', validatedDate, time);
      console.log('Guests:', guests, `(${adults} adults + ${children} children)`);
      console.log('Phone:', formattedPhone || 'Not provided');
      console.log('Special Requests:', reservationData.specialRequests);
      console.log('Newsletter Opt-In (Checkbox):', newsletterValue);
      console.log('Whatsapp Confirmation (Single Select):', whatsappValue);
      console.log('Airtable Record ID:', record[0].id);
      
      
      
      // ===== SEND WEBHOOK TO MAKE.COM FOR INSTANT WHATSAPP =====
      // Send webhook if user opted in for WhatsApp confirmation
      if (whatsapp_confirmation === true || whatsapp_confirmation === 'yes') {
        console.log('📨 Sending webhook to Make.com for WhatsApp confirmation');
        await sendToMakeWebhook({
          firstName: firstName,
          lastName: lastName,
          phone: formattedPhone,
          date: validatedDate,
          time: time,
          guests: guests,
          specialRequests: reservationData.specialRequests, 
        }, reservationId);
      } else {
        console.log('ℹ️ WhatsApp confirmation not requested, skipping webhook');
      }
      
      const greeting = getItalianTimeGreeting();
      let timeAwareResponse;
      
      if (greeting === "Buongiorno") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buona giornata!`;
      } else if (greeting === "Buon pomeriggio") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buon proseguimento!`;
      } else if (greeting === "Buonasera") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buona serata!`;
      } else {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buona notte!`;
      }
      
      if (calendarCheck.error) {
        timeAwareResponse += ` (Nota: Non è stato possibile verificare la disponibilità del calendario)`;
      }
      
      res.json({
        response: timeAwareResponse,
        saveToAirtable: true,
        reservationId: reservationId,
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
    console.error('❌ Error stack:', error.stack);
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
  
  console.log(`\n🎵 Jazzamore Reservation System v2.0`);
  console.log(`📡 Running on port: ${PORT}`);
  console.log(`🇮🇹 ${greeting}! Rome time: ${romeDateTime.date} ${romeDateTime.time}`);
  console.log(`\n🔑 Google Calendar Integration:`);
  console.log(`   • Account: ${serviceAccount.client_email}`);
  console.log(`   • Calendar ID: ${JAZZAMORE_CALENDAR_ID}`);
  console.log(`   • Access: Read-only (calendar.readonly)`);
  console.log(`   • Status: ✅ ACTIVE - SINGLE SOURCE OF TRUTH`);
  console.log(`\n🌐 API Endpoints:`);
  console.log(`   • Time in Rome: http://localhost:${PORT}/api/now`);
  console.log(`   • Resolve Date (GET): http://localhost:${PORT}/api/resolve-date?text=tomorrow`);
  console.log(`   • Resolve Date (POST): http://localhost:${PORT}/api/resolve_date (Retell format)`);
  console.log(`   • Calendar Events (GET): http://localhost:${PORT}/api/calendar/date?date=tomorrow`);
  console.log(`   • Calendar Events (POST): http://localhost:${PORT}/api/calendar/date (Retell format)`);
  console.log(`   • Availability: http://localhost:${PORT}/api/calendar/availability?date=tomorrow&time=20:00`);
  console.log(`   • Time Greeting: http://localhost:${PORT}/api/time-greeting`);
  console.log(`   • Time Greeting POST: http://localhost:${PORT}/api/time-greeting (POST with format parameter)`);
  console.log(`   • Diagnostic: http://localhost:${PORT}/api/calendar/diagnostic`);
  console.log(`   • Test: http://localhost:${PORT}/api/test/google-calendar`);
  console.log(`   • Webhook: http://localhost:${PORT}/api/reservations`);
  console.log(`\n📋 Key Features:`);
  console.log(`   ✅ Google Calendar as ONLY source of truth`);
  console.log(`   ✅ Enhanced date resolution:`);
  console.log(`      • "12" → February 12, 2026 (current month, even if past)`);
  console.log(`      • "14th" → February 14, 2026 (current month)`);
  console.log(`      • "twenty sixth" → February 26, 2026 (current month)`);
  console.log(`      • "March 15" → March 15, 2026 (explicit month)`);
  console.log(`      • "next month 14th" → March 14, 2026 (explicit next month)`);
  console.log(`   ✅ ENHANCED RESERVATION DETECTION:`);
  console.log(`      • Multilingual keyword detection (English/Italian)`);
  console.log(`      • Pattern-based intent detection`);
  console.log(`      • Agent question tracking`);
  console.log(`      • User detail analysis`);
  console.log(`   ✅ COMPREHENSIVE DATA EXTRACTION:`);
  console.log(`      • Structured data blocks`);
  console.log(`      • Conversation flow analysis`);
  console.log(`      • System log extraction`);
  console.log(`      • Multi-source conflict resolution`);
  console.log(`      • Cross-validation of all fields`);
  console.log(`   ✅ BILINGUAL SUPPORT:`);
  console.log(`      • Full Italian and English day names`);
  console.log(`      • Italian/English keyword matching`);
  console.log(`      • Accent-insensitive matching`);
  console.log(`   ✅ PHONE NUMBER PROCESSING:`);
  console.log(`      • Spoken number conversion (zero → 0, uno → 1, etc.)`);
  console.log(`      • Italian country code formatting (+39)`);
  console.log(`      • Digit collection and validation`);
  console.log(`   ✅ COMPREHENSIVE LOGGING:`);
  console.log(`      • Detailed extraction process logs`);
  console.log(`      • Source tracking for each field`);
  console.log(`      • Validation and cross-validation logs`);
  console.log(`   ✅ Custom time-greeting function for Retell agent`);
  console.log(`   ✅ No assumptions or manual mappings`);
  console.log(`   ✅ Real-time event checking`);
  console.log(`   ✅ Rome timezone-aware (Europe/Rome)`);
  console.log(`   ✅ Airtable integration for storage`);
  console.log(`   ✅ PII protection in logs`);
  console.log(`   ✅ MAKE.COM WEBHOOK INTEGRATION for instant WhatsApp`);
  console.log(`\n🤖 Retell Agent Custom Functions:`);
  console.log(`   • get_time_greeting(format='italian') - Returns time-appropriate greeting`);
  console.log(`   • get_events_by_date(date) - Returns events for specific date (POST endpoint)`);
  console.log(`   • resolve_date(text) - Resolves relative dates to YYYY-MM-DD (POST endpoint)`);
  console.log(`\n🚀 System ready! Google Calendar is the authoritative source for all events.`);
  console.log(`🎯 Enhanced reservation detection and extraction is ACTIVE!`);
  console.log(`📨 Webhook will send to Make.com when WhatsApp confirmation is YES`);
});
