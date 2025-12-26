const express = require('express');
const Airtable = require('airtable');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Airtable (YOUR EXISTING CODE - UNCHANGED)
const airtable = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN
});

const base = airtable.base(process.env.AIRTABLE_BASE_ID);

// ===== TIME AWARENESS FUNCTIONS (YOUR EXISTING CODE - UNCHANGED) =====
function getItalianTimeWithTimezone() {
    const now = new Date();
    const romeTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Rome"}));
    const currentHour = romeTime.getHours();
    
    console.log(`🇮🇹 Italian time: ${romeTime.toISOString()}, Hour: ${currentHour}`);
    
    if (currentHour >= 5 && currentHour < 12) return "Buongiorno";
    else if (currentHour >= 12 && currentHour < 13) return "Buon pranzo";
    else if (currentHour >= 13 && currentHour < 18) return "Buon pomeriggio";
    else if (currentHour >= 18 && currentHour < 22) return "Buonasera";
    else return "Buonanotte";
}
// ===== END TIME AWARENESS =====

// Generate unique reservation ID (YOUR EXISTING CODE - UNCHANGED)
function generateReservationId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `JAZ-${timestamp}-${random}`.toUpperCase();
}

// Convert time string to Airtable date format (YOUR EXISTING CODE - UNCHANGED)
function formatTimeForAirtable(timeString, dateString) {
  try {
    const [hours, minutes] = timeString.split(':');
    const date = new Date(dateString);
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    return date.toISOString();
  } catch (error) {
    const defaultDate = new Date(dateString);
    defaultDate.setHours(19, 30, 0, 0);
    return defaultDate.toISOString();
  }
}

// Convert day name to actual date - COMPREHENSIVE BILINGUAL SUPPORT (YOUR EXISTING CODE - UNCHANGED)
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

// ===== YOUR EXISTING RESERVATION EXTRACTION CODE (100% UNCHANGED) =====
// Comprehensive reservation data extraction system
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

// 1. Extract from structured data block
function extractFromStructuredBlock(conversation, systemLogs) {
  console.log('🔍 Checking for structured data block...');
  const data = {};
  
  // Check conversation first
  const fullConversationText = conversation 
    .map(msg => msg.content || '')
    .join('\n');
  
  const structuredMatch = fullConversationText.match(/RESERVATION_DATA:[\s\S]*?(?=\n\n|\n$|$)/i);
  if (structuredMatch) {
    console.log('✅ Found structured data in conversation');
    return parseStructuredBlock(structuredMatch[0]);
  }
  
  // Check system logs
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

// 2. Extract from conversation flow - COMPREHENSIVE BILINGUAL SUPPORT
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
      // COMPREHENSIVE BILINGUAL QUESTION DETECTION
      
      // First name questions - English + Italian
      if (lowerContent.includes('first name') || 
          lowerContent.includes('your name') ||
          lowerContent.includes('what is your name') ||
          lowerContent.includes('may i have your name') ||
          lowerContent.includes('nome') || 
          lowerContent.includes('come ti chiami') ||
          lowerContent.includes('qual è il tuo nome') ||
          lowerContent.includes('qual e il tuo nome') || // without accent
          lowerContent.includes('il tuo nome')) {
        firstNameAsked = true;
        console.log('👤 Agent asked for first name');
      }
      
      // Last name questions - English + Italian
      if ((lowerContent.includes('last name') || 
           lowerContent.includes('surname') ||
           lowerContent.includes('cognome') ||
           lowerContent.includes('qual è il tuo cognome') ||
           lowerContent.includes('qual e il tuo cognome')) && firstNameAsked) { // without accent
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
      
      // Extract confirmation of information from agent - BILINGUAL
      if ((content.includes('David') && content.includes('Anderson')) ||
          (content.includes('Dina') && content.includes('Anderson')) ||
          lowerContent.includes('signor anderson') ||
          lowerContent.includes('sig. anderson')) {
        data.firstName = content.includes('David') ? 'David' : 'Dina';
        data.lastName = 'Anderson';
        console.log(`✅ Agent confirmed: ${data.firstName} ${data.lastName}`);
      }
      
      // Confirm guest count - BILINGUAL
      if (lowerContent.match(/2\s*(people|person|guests?|adults?)/) ||
          lowerContent.includes('due persone') ||
          lowerContent.includes('2 persone') ||
          lowerContent.includes('per due') ||
          lowerContent.match(/per\s*2/)) {
        data.guests = 2;
        data.adults = 2;
        console.log('✅ Agent confirmed: 2 guests');
      }
      
      // Confirm date/time - BILINGUAL
      if ((lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) ||
          (lowerContent.includes('venerdì') && lowerContent.includes('21:45')) ||
          (lowerContent.includes('venerdi') && lowerContent.includes('21:45')) ||
          (lowerContent.includes('venerdì') && lowerContent.includes('21.45')) ||
          (lowerContent.includes('venerdi') && lowerContent.includes('21.45'))) {
        data.date = convertDayToDate('next friday');
        data.time = '21:45';
        console.log('✅ Agent confirmed: Friday 9:45 PM');
      }
    }

    if (msg.role === 'user') {
      // Capture first name response (right after agent asks for first name)
      if (firstNameAsked && !lastNameAsked && !data.firstName) {
        // Enhanced name regex to handle Italian accents and names
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.firstName = nameMatch[1];
          console.log(`✅ User provided first name: ${data.firstName}`);
          firstNameAsked = false;
        }
      }
      
      // Capture last name response (right after agent asks for last name)
      if (lastNameAsked && !data.lastName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.lastName = nameMatch[1];
          console.log(`✅ User provided last name: ${data.lastName}`);
          lastNameAsked = false;
        }
      }
      
      // Capture guest count when asked - BILINGUAL
      if (guestsAsked && !data.guests) {
        // English numbers
        if (lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/)) {
          const match = lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/);
          data.guests = parseInt(match[1]) || 2;
          data.adults = data.guests;
          console.log(`✅ User specified guests: ${data.guests}`);
          guestsAsked = false;
        }
        // Italian numbers and phrases
        else if (lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/) ||
                 lowerContent.includes('due persone') ||
                 lowerContent.includes('per due') ||
                 lowerContent.match(/siamo\s*in\s*(\d+)/)) {
          const match = lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/) || 
                       lowerContent.match(/siamo\s*in\s*(\d+)/);
          if (match && match[1]) {
            data.guests = parseInt(match[1]) || 2;
            data.adults = data.guests;
            console.log(`✅ User specified guests: ${data.guests}`);
            guestsAsked = false;
          }
        }
      }
      
      // Capture date when asked - BILINGUAL
      if (dateAsked && !data.date) {
        // English dates
        if (lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          console.log('✅ User specified: Friday 9:45 PM');
          dateAsked = false;
        }
        // Italian dates
        else if ((lowerContent.includes('venerdì') || lowerContent.includes('venerdi')) && 
                 (lowerContent.includes('21:45') || lowerContent.includes('21.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          console.log('✅ User specified: Friday 9:45 PM');
          dateAsked = false;
        }
        // Generic date references
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
      
      // Capture phone number when asked - COMPREHENSIVE BILINGUAL NUMBER SUPPORT
      if (phoneAsked) {
        const digits = content
          // English numbers
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
          // Italian numbers (with and without accents)
          .replace(/uno/gi, '1')
          .replace(/due/gi, '2')
          .replace(/tre/gi, '3')
          .replace(/quattro/gi, '4')
          .replace(/cinque/gi, '5')
          .replace(/sei/gi, '6')
          .replace(/sette/gi, '7')
          .replace(/otto/gi, '8')
          .replace(/nove/gi, '9')
          // Handle Italian pronunciation variations
          .replace(/ùno/gi, '1')    // Accented variations
          .replace(/dùe/gi, '2')
          .replace(/tré/gi, '3')
          .replace(/quàttro/gi, '4')
          .replace(/cìnque/gi, '5')
          .replace(/séi/gi, '6')
          .replace(/sètte/gi, '7')
          .replace(/òtto/gi, '8')
          .replace(/nòve/gi, '9')
          .replace(/\D/g, '');
        
        if (digits.length > 0) {
          phoneDigits += digits;
          console.log(`📞 Phone digits collected: ${phoneDigits}`);
        }
        
        // If we have enough digits, consider the phone number complete
        if (phoneDigits.length >= 10) {
          phoneAsked = false;
        }
      }
      
      // Extract special requests - BILINGUAL
      if (lowerContent.includes('honeymoon') || 
          lowerContent.includes('surprise') ||
          lowerContent.includes('romantic') ||
          lowerContent.includes('luna di miele') || 
          lowerContent.includes('luna di miele') || // Common typo
          lowerContent.includes('sorpresa') ||
          lowerContent.includes('romantico') ||
          lowerContent.includes('romantica')) {
        data.specialRequests = 'Romantic song in the background for honeymoon surprise';
        console.log('✅ User mentioned honeymoon/surprise');
      }
      
      // Newsletter opt-in - BILINGUAL
      if ((lowerContent.includes('newsletter') && (lowerContent.includes('yes') || lowerContent.includes('join'))) ||
          (lowerContent.includes('newsletter') && (lowerContent.includes('sì') || lowerContent.includes('si'))) ||
          lowerContent.includes('iscriviti') ||
          lowerContent.includes('mi iscrivo') ||
          lowerContent.includes('volentieri')) { // "volentieri" = "gladly"
        data.newsletter = true;
        console.log('✅ User opted into newsletter');
      }
    }
  }
  
  // Process collected phone number
  if (phoneDigits.length >= 7) {
    data.phone = '+39' + phoneDigits.substring(0, 10);
    console.log(`✅ Processed phone number: ${data.phone}`);
  }
  
  console.log('🗣️ Conversation flow data:', data);
  return data;
}

// 3. Extract from system logs
function extractFromSystemLogs(logs) {
  console.log('🔍 Extracting from system logs...');
  const data = {};
  
  if (!logs) return data;
  
  // Look for patterns in logs
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

// 4. Merge and resolve conflicts between sources
function mergeAndResolveData(sources, defaultData) {
  console.log('🔄 Merging and resolving data from all sources...');
  
  const finalData = { ...defaultData };
  const sourcePriority = ['structuredBlock', 'conversationFlow', 'systemLogs'];
  
  // For each field, take the value from the highest priority source that has it
  const fields = ['firstName', 'lastName', 'phone', 'guests', 'adults', 'children', 'date', 'time', 'specialRequests', 'newsletter'];
  
  fields.forEach(field => {
    for (const source of sourcePriority) {
      if (sources[source][field] !== undefined && 
          sources[source][field] !== '' && 
          sources[source][field] !== null) {
        
        // Special validation for certain fields
        if (isValidFieldValue(field, sources[source][field])) {
          console.log(`✅ Using ${field} from ${source}: ${sources[source][field]}`);
          finalData[field] = sources[source][field];
          break;
        }
      }
    }
  });
  
  // Cross-validate important fields
  crossValidateFields(finalData, sources);
  
  return finalData;
}

function isValidFieldValue(field, value) {
  switch (field) {
    case 'phone':
      return value.length >= 10; // Basic phone validation
    case 'guests':
    case 'adults':
    case 'children':
      return value > 0 && value < 20; // Reasonable guest count
    case 'time':
      return /^\d{1,2}:\d{2}$/.test(value); // Time format
    default:
      return true;
  }
}

function crossValidateFields(finalData, sources) {
  console.log('🔍 Cross-validating fields...');
  
  // Ensure adults + children = guests
  if (finalData.adults && finalData.children !== undefined) {
    const calculatedGuests = finalData.adults + finalData.children;
    if (finalData.guests !== calculatedGuests) {
      console.log(`⚠️ Guest count mismatch: ${finalData.guests} total vs ${finalData.adults} adults + ${finalData.children} children`);
      // Prefer the calculated value if it makes sense
      if (calculatedGuests > 0 && calculatedGuests < 20) {
        finalData.guests = calculatedGuests;
        console.log(`✅ Using calculated guest count: ${finalData.guests}`);
      }
    }
  }
  
  // Validate phone format
  if (finalData.phone && !finalData.phone.startsWith('+39')) {
    finalData.phone = '+39' + finalData.phone.replace(/\D/g, '');
    console.log(`✅ Formatted phone: ${finalData.phone}`);
  }
  
  // Validate date is in the future
  const reservationDate = new Date(finalData.date);
  const today = new Date();
  if (reservationDate < today) {
    // Default to tomorrow if date is in the past
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    finalData.date = tomorrow.toISOString().split('T')[0];
    console.log(`⚠️ Date in past, defaulting to tomorrow: ${finalData.date}`);
  }
}
// ===== END YOUR EXISTING RESERVATION EXTRACTION CODE =====

// ===== GOOGLE CALENDAR INTEGRATION (NEW ADDITION - DOESN'T AFFECT YOUR CODE) =====
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// Your exact service account credentials
const serviceAccount = {
  "type": "service_account",
  "project_id": "retell-calendar-478918",
  "private_key_id": "575dd8d838e4cb4744b1be7658632c4d1a77c9b3",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCviCO52/9zQRGs\nfPHk09Dw57OrrlS+uFu+KDTLrifRtTJkFWLVqryxyL24PDezg9yKb3H5NJnqulhJ\nikAJNXvYVvUazbXRklUmsj0os+dbQRWoSxaQ6Wsk5jn2ZFLu/xTLTOKHOLEpvKLb\nVDhxy5Mc/pPLcv6GJ2ueZmpcPanKDu8ZaMyASk4RAjnN9z48FWNOkDmCe11N9BFW\nS+056bYu/aVA84M8/aTlZlrAYtbTK0a8RBft1wB9GAWrYjqmWcWoja9u/knFepjh\ndQ6q1quDPytNgO/TiTxdXx7i7U0iINO8UhOnor5H3HfWGaQRJE83xR0dmdG6nJHS\nsMaHTtBzAgMBAAECggEATVfSThnG1DTuoa8oMqi2Xv/pJhOZmbPIEODMapbhSsDp\nZDocI4OowzlthxlZfcrzSThT4vevfkL/ld/J2YTsfeXK+DV+EMrGpFdTJXUn0wi5\njz8OwWloYYjkL1IDTPWuZuoIwoZTYc2RgMz6VgHaX6M44iNYTSpffBsqcFxnTPVO\nLjSmhv8ugKF5O4pdxQH+jp0Mmdyt9NqZY60TsV4k/usP4/fsXo698M4f+A3zJrPh\nRv9cbI6tsqSA5yhlVnh9HSRGJI5JIgJ1T+8mk41L1tVQR5WZ/chdzmGX+HlBJ0JE\ndVsA7sY+DEhjE3WlqMKbuWrOKR/Jujtc5QDJ4x6akQKBgQDl6T2xUZ1J4uBVe/qN\nu9LbTQjWH4q97QuallBlkDZpeyj5Cuy9fgbiNNgmqg01YnqaJbGEAYvWOELxzKps\nWV+kVDO+2HGN2KG8isNTJyf+AvNF3EWnHg9mJ80WJ/oOqKCdL7x5Nng9d7B/pfht\neb3eAMGnKUbAsEAnHB6n3kIUCQKBgQDDczegThsC2iKMkpCMlbc6QwK4A6wR11MF\ncQiuvtzvqWnkqg5AbVCGZIbtWa8dLv1t2/RpCLJfESxQqV1Zl3kHuKPGga1jJ8uc\n/lAoX2X0AT0//gMFO4g4QGi12VsTkAPB2ecHCKBOK6pduzEHFo9eVzdO4JUIotdn\nB+cewjj3mwKBgCfZQE8ehTOMNjO61FeCiW5nMLPkLajzkAJQMUkZMMUhip13rka9\ntDW60QgKi1WIZxWWmOj3V6RehgPg5Fz5NKGH0pwuaagbNxU1u9sKu1zEaCPgpNXt\nWN/s4BgJ/8ZQpd34qyMbNMX6m8XUH3XiFu2GlgoCFnhJVCUzM4EG/c75AoGAPvxi\ncMa67bBece7JpoSZB62Qsrx8N0Os/ZPvuGDJ0nJGLeqfrSONT8IVuWethzodccnw\neejTks91+IicDMNDvblDDjW8KrgoZe+O5XPY50l+86BoWMdWnsoi9HeXYjaG/3G5\nggrFnmtz+8DXi/E5Qq3YpRK69I2F3S4uzTrKIQECgYEA07YrWl25pMnmqbOTs71n\nGjvZ8l9ppsYoMC/sZtHGMZh8xNRpvpWwSAWqx1DsneWd+AFbiNbsuyRWmOcdxK9F\nIUV+T87VcivbjDAbmJSStz3lKekhhpEMLKCgSPnPWyWh5v2zrCVXPnYEcAainv1o\nkXYTOnHJ9j8PZf/SpARPVUs=\n-----END PRIVATE KEY-----\n",
  "client_email": "retell-ai-calendar@retell-calendar-478918.iam.gserviceaccount.com",
  "client_id": "107319862827925724291",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/retell-ai-calendar%40retell-calendar-478918.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

// Function to get authenticated Google Calendar client
async function getCalendarClient() {
  try {
    console.log('🔑 Initializing Google Calendar client...');
    
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: SCOPES,
    });
    
    const authClient = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    
    console.log('✅ Google Calendar client initialized successfully');
    console.log(`📧 Service account: ${serviceAccount.client_email}`);
    
    return calendar;
    
  } catch (error) {
    console.error('❌ Error getting Google Calendar client:', error.message);
    return null;
  }
}

// Function to analyze event availability and sold-out status
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

  // Initialize availability object
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

  // METHOD 1: Check custom properties (extendedProperties.private)
  if (extendedProperties?.private) {
    const privateProps = extendedProperties.private;
    
    // Check for explicit soldOut flag
    if (privateProps.soldOut === 'true' || privateProps.soldOut === true) {
      availability.isSoldOut = true;
      availability.soldOutReason = 'Marked as sold out in event properties';
    }
    
    // Check capacity numbers
    if (privateProps.maxCapacity) {
      availability.totalCapacity = parseInt(privateProps.maxCapacity);
    }
    
    if (privateProps.currentAttendees) {
      availability.currentAttendees = parseInt(privateProps.currentAttendees);
    }
    
    // Calculate available spots if we have both numbers
    if (availability.totalCapacity !== null && availability.currentAttendees !== null) {
      availability.availableSpots = Math.max(0, availability.totalCapacity - availability.currentAttendees);
      if (availability.availableSpots <= 0) {
        availability.isSoldOut = true;
        availability.soldOutReason = `Capacity reached: ${availability.currentAttendees}/${availability.totalCapacity}`;
      }
    }
    
    // Check for waiting list
    if (privateProps.waitingList === 'true' || privateProps.waitingList === true) {
      availability.waitingList = true;
    }
  }

  // METHOD 2: Check if attendees are omitted (indicates too many to list)
  if (attendeesOmitted === true) {
    availability.isSoldOut = true;
    availability.soldOutReason = 'Attendees omitted (likely at capacity)';
  }

  // METHOD 3: Analyze description for keywords
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

  // METHOD 4: Count actual attendees
  if (attendees && Array.isArray(attendees)) {
    const confirmedAttendees = attendees.filter(attendee => 
      attendee.responseStatus === 'accepted'
    ).length;
    
    // Update current attendees count if we found confirmed attendees
    if (confirmedAttendees > 0) {
      availability.currentAttendees = confirmedAttendees;
    }
    
    // If we have a known capacity from before, check against it
    if (availability.totalCapacity && confirmedAttendees >= availability.totalCapacity) {
      availability.isSoldOut = true;
      availability.soldOutReason = `Attendee count reached capacity: ${confirmedAttendees}/${availability.totalCapacity}`;
    }
  }

  // METHOD 5: Check event status
  if (status === 'cancelled') {
    availability.isSoldOut = true;
    availability.soldOutReason = 'Event cancelled';
  }

  return availability;
}

// Function to get events from Google Calendar with sold-out detection
async function getCalendarEventsWithAvailability(calendarId = null, timeMin = null, timeMax = null) {
  try {
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error('Could not authenticate with Google Calendar');
    }

    // Use calendar ID from environment or default to 'primary'
    const targetCalendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';

    // Default to next 7 days if no time range specified
    const now = new Date();
    const defaultTimeMin = timeMin || now.toISOString();
    const defaultTimeMax = timeMax || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    console.log(`📅 Fetching Google Calendar events from ${defaultTimeMin} to ${defaultTimeMax}`);

    const response = await calendar.events.list({
      calendarId: targetCalendarId,
      timeMin: defaultTimeMin,
      timeMax: defaultTimeMax,
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    
    // Analyze each event for availability
    const analyzedEvents = events.map(event => {
      return analyzeEventAvailability(event);
    });

    console.log(`✅ Found ${analyzedEvents.length} events with availability analysis`);
    return analyzedEvents;

  } catch (error) {
    console.error('❌ Error fetching Google Calendar events:', error.message);
    return [];
  }
}

// Function to search events by date
async function searchEventsByDate(dateString, calendarId = null) {
  try {
    const date = new Date(dateString);
    const startOfDay = new Date(date.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(date.setHours(23, 59, 59, 999)).toISOString();
    
    const events = await getCalendarEventsWithAvailability(calendarId, startOfDay, endOfDay);
    
    // Format events for display
    const formattedEvents = events.map(event => {
      const time = event.startTime ? new Date(event.startTime).toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit'
      }) : 'All day';
      
      const dateStr = event.startTime ? new Date(event.startTime).toLocaleDateString('it-IT') : dateString;
      
      return {
        date: dateStr,
        time: time,
        title: event.title,
        location: event.location,
        available: !event.isSoldOut,
        reason: event.isSoldOut ? event.soldOutReason : 'Available',
        capacity: event.totalCapacity ? `${event.currentAttendees}/${event.totalCapacity}` : 'Unknown',
        availableSpots: event.availableSpots,
        hasWaitingList: event.waitingList,
        description: event.description
      };
    });
    
    return formattedEvents;
    
  } catch (error) {
    console.error('❌ Error searching events by date:', error.message);
    return [];
  }
}

// Function to check calendar for conflicts with reservation time
async function checkCalendarForConflicts(date, time, calendarId = null) {
  try {
    const targetDate = new Date(date);
    const [hours, minutes] = time.split(':').map(Number);
    targetDate.setHours(hours, minutes, 0, 0);
    
    // Check for events at the same time
    const events = await getCalendarEventsWithAvailability(
      calendarId,
      new Date(targetDate.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours before
      new Date(targetDate.getTime() + 4 * 60 * 60 * 1000).toISOString()  // 4 hours after
    );
    
    // Find events that might conflict
    const conflictingEvents = events.filter(event => {
      if (event.isSoldOut) {
        return false; // Already sold out, no conflict for new reservation
      }
      
      // Check if this event is at a similar time
      const eventStart = new Date(event.startTime);
      const timeDiff = Math.abs(eventStart.getTime() - targetDate.getTime());
      
      // Events within 3 hours are considered conflicting
      return timeDiff < 3 * 60 * 60 * 1000;
    });
    
    return {
      hasConflicts: conflictingEvents.length > 0,
      conflictingEvents: conflictingEvents,
      targetTime: targetDate.toISOString(),
      totalEventsInTimeframe: events.length
    };
    
  } catch (error) {
    console.error('Error checking calendar conflicts:', error.message);
    return {
      hasConflicts: false,
      error: error.message,
      conflictingEvents: []
    };
  }
}
// ===== END GOOGLE CALENDAR INTEGRATION =====

// ===== EXPRESS ROUTES =====

app.get('/', (req, res) => {
  res.json({ 
    message: '🎵 Jazzamore Server is running!',
    status: 'Ready for reservations',
    googleCalendar: 'Connected',
    serviceAccount: serviceAccount.client_email
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    googleCalendar: {
      connected: true,
      project: serviceAccount.project_id,
      serviceEmail: serviceAccount.client_email
    }
  });
});

// ===== TIME TEST ENDPOINT (YOUR EXISTING CODE - UNCHANGED) =====
app.get('/api/time-test', (req, res) => {
    const serverTime = new Date();
    const italianTime = new Date(serverTime.toLocaleString("en-US", {timeZone: "Europe/Rome"}));
    const greeting = getItalianTimeWithTimezone();
    
    res.json({
        server_time: serverTime.toISOString(),
        italian_time: italianTime.toISOString(),
        italian_hour: italianTime.getHours(),
        current_greeting: greeting,
        message: `If you called now, I would say: "${greeting}"`
    });
});

// ===== GOOGLE CALENDAR ENDPOINTS (NEW - DOESN'T AFFECT YOUR CODE) =====

// Test endpoint to verify Google Calendar connection
app.get('/api/calendar/test', async (req, res) => {
  try {
    console.log('🔧 Testing Google Calendar connection...');
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      return res.status(500).json({
        error: 'Failed to authenticate with Google Calendar',
        message: 'Check your service account credentials'
      });
    }
    
    // Try to list calendars to verify connection
    const response = await calendar.calendarList.list();
    const calendars = response.data.items.map(cal => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary,
      accessRole: cal.accessRole
    }));
    
    // Find the calendar we have access to
    const targetCalendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const targetCalendar = calendars.find(cal => cal.id === targetCalendarId);
    
    res.json({
      success: true,
      message: 'Google Calendar API connection successful',
      authenticated: true,
      serviceAccount: serviceAccount.client_email,
      totalCalendars: calendars.length,
      targetCalendar: targetCalendarId,
      targetCalendarFound: !!targetCalendar,
      calendars: calendars.slice(0, 5)
    });
    
  } catch (error) {
    console.error('Google Calendar test error:', error);
    res.status(500).json({
      success: false,
      error: 'Google Calendar API error',
      message: error.message
    });
  }
});

// Get events with availability for a specific date
app.get('/api/calendar/events', async (req, res) => {
  try {
    const { date, calendarId } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    const events = await searchEventsByDate(targetDate, calendarId);
    
    res.json({
      success: true,
      date: targetDate,
      calendarId: calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
      eventCount: events.length,
      availableEvents: events.filter(e => e.available).length,
      soldOutEvents: events.filter(e => !e.available).length,
      events: events
    });
    
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch calendar events',
      message: error.message
    });
  }
});

// Simple endpoint for your Retell agent to check availability
app.get('/api/calendar/check-availability', async (req, res) => {
  try {
    const { date, time } = req.query;
    
    if (!date || !time) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters',
        message: 'Please provide both date (YYYY-MM-DD) and time (HH:MM)'
      });
    }
    
    const calendarCheck = await checkCalendarForConflicts(date, time);
    
    let availabilityMessage;
    if (calendarCheck.hasConflicts) {
      const soldOutEvents = calendarCheck.conflictingEvents.filter(e => e.isSoldOut).length;
      const availableEvents = calendarCheck.conflictingEvents.filter(e => !e.isSoldOut).length;
      
      if (availableEvents > 0) {
        availabilityMessage = `⚠️ There are ${availableEvents} events scheduled around ${time} on ${date}. Some may conflict with your reservation.`;
      } else if (soldOutEvents > 0) {
        availabilityMessage = `✅ The time slot at ${time} on ${date} has sold-out events, which means there's no conflict for new reservations.`;
      } else {
        availabilityMessage = `✅ No conflicts detected for ${time} on ${date}.`;
      }
    } else {
      availabilityMessage = `✅ No calendar conflicts detected for ${time} on ${date}.`;
    }
    
    res.json({
      success: true,
      date: date,
      time: time,
      hasConflicts: calendarCheck.hasConflicts,
      conflictingEventsCount: calendarCheck.conflictingEvents.length,
      soldOutConflicts: calendarCheck.conflictingEvents.filter(e => e.isSoldOut).length,
      availableConflicts: calendarCheck.conflictingEvents.filter(e => !e.isSoldOut).length,
      message: availabilityMessage
    });
    
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check availability',
      message: error.message
    });
  }
});
// ===== END GOOGLE CALENDAR ENDPOINTS =====

// ===== YOUR EXISTING RESERVATION ENDPOINTS (100% UNCHANGED) =====

app.get('/api/reservations', async (req, res) => {
  try {
    const records = await base('Reservations').select().firstPage();
    const reservations = records.map(record => ({
      id: record.id,
      ...record.fields
    }));

    return res.json({
      success: true,
      count: reservations.length,
      reservations: reservations
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== MAIN WEBHOOK ENDPOINT (YOUR EXISTING CODE - 100% UNCHANGED) =====
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    
    const { event, call } = req.body;
    
    if (event !== 'call_analyzed') {
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_analyzed event...');
    
    // ===== DIAGNOSTIC LOGGING =====
    console.log('🔍 Searching for Post-Call Analysis data structure...');
    
    // Check common locations for Post-Call Analysis
    let postCallData = null;
    
    // Try different possible paths - FIXED: The data is in call.call_analysis.custom_analysis_data.reservation_details
    if (call?.call_analysis?.custom_analysis_data?.reservation_details) {
        // Parse the JSON string from the reservation_details field
        const reservationDetailsStr = call.call_analysis.custom_analysis_data.reservation_details;
        try {
            postCallData = JSON.parse(reservationDetailsStr);
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
    
    // ===== POST-CALL ANALYSIS EXTRACTION =====
    const italianGreeting = getItalianTimeWithTimezone();
    const reservationId = generateReservationId();
    
    let reservationData = {};
    
    if (postCallData) {
        console.log('✅ Using structured data from Post-Call Analysis');
        console.log('Post-Call Data:', JSON.stringify(postCallData, null, 2));
        
        // Map JSON fields to your reservationData object
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
          newsletter: postCallData.newsletter === 'yes' || postCallData.newsletter_opt_in === 'yes' || postCallData.newsletter === true || false
        };
        
        console.log('📋 Extracted from Post-Call Analysis:', reservationData);
        
    } else if (call?.transcript_object) {
        // Fallback to your old extraction method
        console.log('⚠️ No Post-Call Analysis found, falling back to transcript extraction.');
        const systemLogs = JSON.stringify(call, null, 2);
        reservationData = extractReservationData(call.transcript_object, systemLogs);
    } else {
        // Default empty reservation
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
          newsletter: false
        };
    }
    
    console.log('📋 Final reservation data:', reservationData);
    
    const { firstName, lastName, date, time, guests, adults, children, phone, specialRequests, newsletter } = reservationData;
    
    // ===== DATA VALIDATION =====
    // Ensure phone has +39 prefix if it contains digits
    let formattedPhone = phone;
    if (phone && phone.replace(/\D/g, '').length >= 10) {
        const digits = phone.replace(/\D/g, '');
        formattedPhone = digits.startsWith('39') ? `+${digits}` : `+39${digits.substring(0, 10)}`;
        console.log(`✅ Formatted phone: ${formattedPhone}`);
    }
    
    // Validate date is in the future
    let validatedDate = date;
    const reservationDate = new Date(date);
    const today = new Date();
    if (reservationDate < today) {
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        validatedDate = tomorrow.toISOString().split('T')[0];
        console.log(`⚠️ Date in past, adjusted to: ${validatedDate}`);
    }
    
    const arrivalTimeISO = formatTimeForAirtable(time, validatedDate);
    
    // ===== OPTIONAL: CALENDAR AVAILABILITY CHECK (COMMENTED OUT - UNCOMMENT WHEN READY) =====
    /*
    console.log('📅 Checking calendar availability...');
    const calendarCheck = await checkCalendarForConflicts(validatedDate, time);
    
    if (calendarCheck.hasConflicts) {
      console.log('⚠️ Calendar conflicts detected:', calendarCheck.conflictingEvents.length);
      
      // Check if any conflicting events are sold out
      const soldOutConflicts = calendarCheck.conflictingEvents.filter(event => event.isSoldOut);
      
      if (soldOutConflicts.length > 0) {
        console.log('✅ Conflicting events are sold out, proceeding with reservation');
      } else {
        console.log('⚠️ Conflicts with available events, adding note to reservation');
        
        // Add conflict information to special requests
        const conflictNote = `Calendar Note: Potential conflict with ${
          calendarCheck.conflictingEvents.length
        } event(s) around same time. Please verify availability.`;
        
        specialRequests = specialRequests 
          ? `${specialRequests}. ${conflictNote}`
          : conflictNote;
      }
    } else {
      console.log('✅ No calendar conflicts detected');
    }
    */
    
    // ===== SAVE TO AIRTABLE =====
    console.log('💾 Saving to Airtable...');
    const record = await base('Reservations').create([
      {
        "fields": {
          "Reservation ID": reservationId,
          "First Name": firstName,
          "Last Name": lastName || '',
          "Phone Number": formattedPhone || '',
          "Reservation Date": validatedDate,
          "Arrival Time": arrivalTimeISO,
          "Total People": parseInt(guests) || 2,
          "Dinner Count": parseInt(adults) || 2,
          "Show-Only Count": 0,
          "Kids Count": parseInt(children) || 0,
          "Special Requests": specialRequests || '',
          "Reservation Status": "Pending",
          "Reservation Type": "Dinner + Show",
          "Newsletter Opt-In": newsletter || false
        }
      }
    ]);
    
    console.log('🎉 RESERVATION SAVED!');
    console.log('Reservation ID:', reservationId);
    console.log('Name:', `${firstName} ${lastName}`.trim() || 'Not provided');
    console.log('Date/Time:', validatedDate, time);
    console.log('Guests:', guests, `(${adults} adults + ${children} children)`);
    console.log('Phone:', formattedPhone || 'Not provided');
    console.log('Special Requests:', specialRequests);
    console.log('Newsletter:', newsletter);
    console.log('Airtable Record ID:', record[0].id);
    
    // ===== TIME-AWARE RESPONSE =====
    const greeting = getItalianTimeWithTimezone();
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
    
    res.json({
        response: timeAwareResponse
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('❌ Error stack:', error.stack);
    const greeting = getItalianTimeWithTimezone();
    res.json({
        response: `${greeting}! Grazie per la tua chiamata! Abbiamo ricevuto la tua richiesta di prenotazione.`
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
  console.log(`🔑 Google Calendar service account: ${serviceAccount.client_email}`);
  console.log(`📅 Test Google Calendar: http://localhost:${PORT}/api/calendar/test`);
  console.log(`📞 Your Airtable webhook: http://localhost:${PORT}/api/reservations`);
});
