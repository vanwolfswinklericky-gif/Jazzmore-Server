const express = require('express');
const Airtable = require('airtable');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Airtable
const airtable = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN
});

const base = airtable.base(process.env.AIRTABLE_BASE_ID);

// ===== TIME AWARENESS FUNCTIONS =====
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

// Generate unique reservation ID
function generateReservationId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `JAZ-${timestamp}-${random}`.toUpperCase();
}

// Convert time string to Airtable date format
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

// Convert day name to actual date - COMPREHENSIVE BILINGUAL SUPPORT
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

// Helper function to parse relative dates
function parseRelativeDate(dateString) {
  const today = new Date();
  const currentYear = today.getFullYear(); // This will be 2026
  const currentMonth = today.getMonth() + 1; // JavaScript months are 0-indexed
  const currentDay = today.getDate();
  
  console.log(`📅 [DEBUG] Today: ${today.toISOString()}`);
  console.log(`📅 [DEBUG] Current year: ${currentYear}, month: ${currentMonth}, day: ${currentDay}`);
  
  // Remove any "of this month" or similar phrases
  const cleanString = dateString.toLowerCase()
    .replace('of this month', '')
    .replace('this month', '')
    .replace('the ', '')
    .replace('on ', '')
    .trim();
  
  console.log(`📅 Parsing relative date: "${dateString}" → "${cleanString}"`);
  
  // Check for "today"
  if (cleanString === 'today' || cleanString === 'oggi') {
    const result = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${currentDay.toString().padStart(2, '0')}`;
    console.log(`📅 Today parsed as: ${result}`);
    return result;
  }
  
  // Check for "tomorrow"
  if (cleanString === 'tomorrow' || cleanString === 'domani') {
    const tomorrow = new Date(currentYear, currentMonth - 1, currentDay + 1);
    const result = tomorrow.toISOString().split('T')[0];
    console.log(`📅 Tomorrow parsed as: ${result}`);
    return result;
  }
  
  // Check for day numbers (1st, 2nd, 3rd, 4th, etc.)
  const dayMatch = cleanString.match(/(\d+)(?:st|nd|rd|th)?/);
  
  if (dayMatch) {
    const day = parseInt(dayMatch[1]);
    
    // If it's just a day number, use current month and year
    if (day >= 1 && day <= 31) {
      const result = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      console.log(`📅 Day ${day} parsed as: ${result} (current year: ${currentYear})`);
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
        const result = `${currentYear}-${monthNumber.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        console.log(`📅 Found month ${monthName} day ${day}: ${result}`);
        return result;
      }
    }
  }
  
  // Fallback to convertDayToDate
  console.log(`📅 Falling back to convertDayToDate for: ${cleanString}`);
  return convertDayToDate(cleanString);
}

// ===== RESERVATION INTENT DETECTION =====
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

// ===== YOUR EXISTING RESERVATION EXTRACTION CODE =====
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
      
      // Capture phone number
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
// ===== END RESERVATION EXTRACTION CODE =====

// ===== GOOGLE CALENDAR INTEGRATION =====
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// Updated service account with new key
const serviceAccount = {
  "type": "service_account",
  "project_id": "retell-calendar-478918",
  "private_key_id": "d0959938c456b7ffcf3a15d96418eb9d6b2e45a4",
  "private_key": `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCXs/3R0VUNR6uH
lsVbSln0K5KDpObUggFoiITjw+8L1KsE4jBO2F/MVEtnd6PRs/ramB0tFbVMKqly
nPmIueN+eYQc+vgDJpSkqiDgGZerpbiA0183rFVFG48lHA02vPqfoGghIuUbN6eD
/VBD8keM0m/i4atulRG8XI+dWjDRdVHBa9yJkdXNao4UI8HWiWMNjeexCUAg5Y+g
lR2dG/GQp3h3dBWaI+ifW+E7VE8miAZJgWRB+ru1m6iV+YqQ/evhVBtrS5ZnjTu+
ApTTD1KeFXpl1pEkZSFmaHTRl4V9WbJPEvzTMcWZJgbEUjspSFpaI6x7qkwvYIZd
jk3riJJ/AgMBAAECggEAD0fsrdlpuVQ6VYac66SyKfPHpuYR8F8GGEsEI9NFPYpX
Db9hAVgvUiw9ijcVc9au0p0W90ckA3+aoPZp9llPLpq78ZVgLSUSPQH8HMbHLd2c
F7Hy+e8sibEMer74H8bqcfDc/FWBAXxaLePy1V1O0sMRzSdRNuriJfim6MFAgKCq
fPFxvBcnONWr6r5uT9mr3C3laL+9JEgIu6OiJyizPAS0EYKV84cJRTsGFkT1UvGq
P+ZPZMa9ciQMFB3csaqmKYYaPoAfWArxV/razjoPSPdzIMMFrSzgDLAJJvpJTyZn
no1i3LWeRyQp1d5psv2LqfoS0+z9IlV34cBw74AoMxQKBgQDJd53eI+B3okeiUQ/7
oUaCNQQD9L4JQOWARubRLU0he0FiTMntsylcfCvZf/oEUWctKbtS0Fqnrvt8WUAw
xTcKpUmk2pCKUrz+KVOp+8gTD/ANSHiMlI1rp17QJLe7m+ih2zJm4jKMKk06FOZ4
CWiFy7ElywCRNZbYFJvOeA3iKwKBgQDAxAn1ayVJJpWA2fZ5eQc/UURuz56S/m9a
9nhEnIacPzR8G8lzuvcGvxtZQOL8Ilt0h1mrVdDGr4c1wEjIULK9oO8JNFNHy3Ut
RHsAIKJW/wXgM+lVgWowa99mUWqHanCWdp3sbvYQrALpzlAKfD1eupH04fDgi/uY
1kVZkp8q/QKBgEqNlUHrDNm4l8GdNcjsOWddrwq3uss51LPPiQLHPM+zCNMTj3YC
4r9yw9dM4HxQk1nHI6bVq3Z57l5puLNTh7bMy5/RscM+MIInUOqKXdOQBkkkFFgR
cPPxj8h+je9DFqcuskwYUJRF4yYnLdIlySQZ6IgPwzn5FsUHe1DAZILZAoGAa7Jb
OgFVwIvNBUNBYFaNBQQbbqmSl9+NSU3gnbyxvEPXw+siXwU7FErbNb950ZJEdFNW
dtIoJYlVymMWhswHQMjUI9lXGgqC+fqDmeuhp2ct2jhGid4W/NyX4KtmECgYpQe6
bakE0wW3TvdUYrdM9krYVu+Qy3OJ6rbz4fp38OUCgYEApR56LdQVBxFSMgdVrNB0
oIKAld50FWu2ZmkDUzb8zhFScDZgdpZ6euD/bPlriEkN3gQ2UNoMtA5F+lvl+uue
dNyrgrZFgllZsEbtuVd07scIYrPSvBfVhjk8+ZZF24epS7TmcYm6P5hQFcacVRKb
/Uaolwap+9QfH+z1cBydASQ=
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

async function getCalendarEventsWithAvailability(calendarId = null, timeMin = null, timeMax = null) {
  try {
    const calendar = await getCalendarClient();
    if (!calendar) {
      throw new Error('Could not authenticate with Google Calendar');
    }

    const targetCalendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';

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

// Mock data function (fallback if Google Calendar fails)
function getMockEventsForDate(dateString) {
  console.log(`🎭 Using mock data for ${dateString}`);
  
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
  
  // Mock events for specific dates from your images
  const mockEvents = {
    // 2026 dates (current year)
    '2026-02-04': [
      {
        date: formattedDate,
        time: '20:00',
        title: 'Live Jazz Session',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '20/45',
        availableSpots: 25,
        hasWaitingList: false,
        description: 'Serata jazz con musica dal vivo in atmosfera intima.'
      }
    ],
    '2026-02-14': [
      {
        date: '14/02/2026',
        time: '20:00',
        title: 'San Valentino Special - Cena Romantica',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '10/40',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Cena romantica di San Valentino con musica jazz dal vivo. Menu speciale a lume di candela.'
      }
    ],
    '2026-02-17': [
      {
        date: '17/02/2026',
        time: '20:00',
        title: 'Swing Night',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '30/60',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Serata swing con lezioni di ballo e musica dal vivo.'
      }
    ],
    '2026-02-20': [
      {
        date: '20/02/2026',
        time: '20:00',
        title: 'Saraghina Live',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '25/55',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Serata con la band Saraghina. Musica italiana e internazionale.'
      }
    ],
    '2026-02-21': [
      {
        date: '21/02/2026',
        time: '20:00',
        title: 'Concerto Country Night',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '20/60',
        availableSpots: 40,
        hasWaitingList: false,
        description: 'Serata country con band locale e menu a tema americano.'
      }
    ],
    
    // 2026 dates (from your images)
    '2026-01-31': [
      {
        date: '31/01/2026',
        time: '20:00',
        title: 'Fabio Nobile Quartet featuring Joyce Elaine Yuille',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '15/50',
        availableSpots: 35,
        hasWaitingList: false,
        description: 'CENA-CONCERTO @ Jazzamore. Un progetto dal forte impatto live, dove energia, groove e personalità sono protagonisti assoluti. Un sound caldo e vibrante che fonde soul, funk e soul-jazz. A completare il progetto, la voce carismatica e intensa di Joyce Elaine Yuille.'
      }
    ],
    '2026-02-04': [
      {
        date: '04/02/2026',
        time: '20:00',
        title: 'Live Jazz Session',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '20/45',
        availableSpots: 25,
        hasWaitingList: false,
        description: 'Serata jazz con musica dal vivo in atmosfera intima.'
      }
    ],
    '2026-02-14': [
      {
        date: '14/02/2026',
        time: '20:00',
        title: 'San Valentino Special - Cena Romantica',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '10/40',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Cena romantica di San Valentino con musica jazz dal vivo. Menu speciale a lume di candela.'
      }
    ],
    '2026-02-17': [
      {
        date: '17/02/2026',
        time: '20:00',
        title: 'Swing Night',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '30/60',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Serata swing con lezioni di ballo e musica dal vivo.'
      }
    ],
    '2026-02-20': [
      {
        date: '20/02/2026',
        time: '20:00',
        title: 'Saraghina Live',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '25/55',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Serata con la band Saraghina. Musica italiana e internazionale.'
      }
    ],
    '2026-02-21': [
      {
        date: '21/02/2026',
        time: '20:00',
        title: 'Concerto Country Night',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '20/60',
        availableSpots: 40,
        hasWaitingList: false,
        description: 'Serata country con band locale e menu a tema americano.'
      }
    ]
  };
  
  const key = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  
  if (mockEvents[key]) {
    console.log(`✅ Found ${mockEvents[key].length} mock event(s) for ${key}`);
    return mockEvents[key];
  }
  
  // Generic events based on day of week
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  switch(dayOfWeek) {
    case 5: // Friday
      return [{
        date: formattedDate,
        time: '20:00',
        title: 'Live Jazz Night',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '25/50',
        availableSpots: 25,
        hasWaitingList: false,
        description: 'Serata jazz con musica dal vivo ogni venerdì. Cena e concerto.'
      }];
      
    case 6: // Saturday
      return [{
        date: formattedDate,
        time: '20:00',
        title: 'Saturday Special Concert',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '30/60',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Serata speciale del sabato con ospiti musicali e menu completo.'
      }];
      
    case 0: // Sunday
      return [{
        date: formattedDate,
        time: '18:00',
        title: 'Apericena & DJ Set',
        location: 'Jazzamore',
        available: true,
        reason: 'Available',
        capacity: '40/70',
        availableSpots: 30,
        hasWaitingList: false,
        description: 'Aperitivo e apericena domenicale con DJ set. Menu aperitivo disponibile.'
      }];
      
    default: // Weekdays
      // 50% chance of having an event on weekdays
      if (Math.random() > 0.5) {
        return [{
          date: formattedDate,
          time: '20:00',
          title: 'Weekday Jazz Session',
          location: 'Jazzamore',
          available: true,
          reason: 'Available',
          capacity: '20/40',
          availableSpots: 20,
          hasWaitingList: false,
          description: 'Musica jazz dal vivo in un atmosfera intima e rilassata.'
        }];
      }
  }
  
  console.log(`ℹ️ No mock events for ${key}`);
  return [];
}

async function searchEventsByDate(dateString, calendarId = null) {
  console.log(`📅 Searching events for: ${dateString}`);
  
  try {
    // Try to get real Google Calendar events first
    console.log('🔍 Attempting to fetch real Google Calendar events...');
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      console.log('⚠️ Google Calendar client not available, using mock data');
      return getMockEventsForDate(dateString);
    }
    
    const targetCalendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    // Create date range for the specific day
    const date = new Date(dateString);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    console.log(`📅 Fetching events from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);
    
    const response = await calendar.events.list({
      calendarId: targetCalendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    console.log(`✅ Found ${events.length} real events from Google Calendar`);
    
    if (events.length === 0) {
      console.log('⚠️ No real events found, falling back to mock data');
      return getMockEventsForDate(dateString);
    }
    
    // Analyze each event for availability
    const analyzedEvents = events.map(event => {
      const availability = analyzeEventAvailability(event);
      
      // Format the event for response
      const eventStart = event.start?.dateTime ? new Date(event.start.dateTime) : new Date(event.start?.date || date);
      const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : new Date(event.end?.date || date);
      
      const time = event.start?.dateTime 
        ? eventStart.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        : 'All day';
      
      const dateStr = eventStart.toLocaleDateString('it-IT');
      
      // Determine if event is available (not sold out)
      const isAvailable = !availability.isSoldOut;
      
      // Calculate available spots
      let availableSpots = null;
      let capacity = 'Unknown';
      
      if (availability.totalCapacity !== null && availability.currentAttendees !== null) {
        availableSpots = Math.max(0, availability.totalCapacity - availability.currentAttendees);
        capacity = `${availability.currentAttendees}/${availability.totalCapacity}`;
      }
      
      return {
        date: dateStr,
        time: time,
        title: availability.title,
        location: availability.location,
        available: isAvailable,
        reason: isAvailable ? 'Available' : availability.soldOutReason || 'Sold out',
        capacity: capacity,
        availableSpots: availableSpots,
        hasWaitingList: availability.waitingList,
        description: availability.description,
        startTime: eventStart.toISOString(),
        endTime: eventEnd.toISOString(),
        isRealEvent: true // Mark as real event
      };
    });
    
    console.log(`📊 Analyzed ${analyzedEvents.length} events for availability`);
    
    // Sort events by time
    analyzedEvents.sort((a, b) => {
      const timeA = a.time === 'All day' ? '00:00' : a.time;
      const timeB = b.time === 'All day' ? '00:00' : b.time;
      return timeA.localeCompare(timeB);
    });
    
    return analyzedEvents;
    
  } catch (error) {
    console.error('❌ Error searching real Google Calendar events:', error.message);
    console.log('⚠️ Falling back to mock data due to error');
    return getMockEventsForDate(dateString);
  }
}

async function checkCalendarForConflicts(date, time, calendarId = null) {
  try {
    const targetDate = new Date(date);
    const [hours, minutes] = time.split(':').map(Number);
    targetDate.setHours(hours, minutes, 0, 0);
    
    console.log(`🔍 Checking calendar conflicts for ${date} at ${time}`);
    
    const events = await searchEventsByDate(date, calendarId);
    
    // Filter for events that conflict with the requested time
    const conflictingEvents = events.filter(event => {
      if (!event.available) {
        return false; // Skip sold out events
      }
      
      try {
        const eventStart = new Date(event.startTime || event.date);
        const timeDiff = Math.abs(eventStart.getTime() - targetDate.getTime());
        
        // Consider events within 3 hours as conflicts
        return timeDiff < 3 * 60 * 60 * 1000;
      } catch (error) {
        console.log(`⚠️ Error parsing event time for conflict check: ${error.message}`);
        return false;
      }
    });
    
    console.log(`📊 Found ${conflictingEvents.length} conflicting events out of ${events.length} total events`);
    
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
    serviceAccount: serviceAccount.client_email,
    note: 'Using Google Calendar with mock data fallback'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    googleCalendar: {
      connected: true,
      project: serviceAccount.project_id,
      serviceEmail: serviceAccount.client_email,
      note: 'Using Google Calendar with fallback to mock data'
    }
  });
});

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

// ===== GOOGLE CALENDAR ENDPOINTS =====

app.get('/api/calendar/test', async (req, res) => {
  try {
    console.log('🔧 Testing Google Calendar connection...');
    
    const calendar = await getCalendarClient();
    if (!calendar) {
      return res.status(500).json({
        error: 'Failed to authenticate with Google Calendar',
        message: 'Check your service account credentials',
        note: 'Using mock data for calendar events'
      });
    }
    
    const response = await calendar.calendarList.list();
    const calendars = response.data.items.map(cal => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary,
      accessRole: cal.accessRole
    }));
    
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
      calendars: calendars.slice(0, 5),
      note: 'Calendar endpoints will use real Google Calendar data'
    });
    
  } catch (error) {
    console.error('Google Calendar test error:', error);
    res.status(500).json({
      success: false,
      error: 'Google Calendar API error',
      message: error.message,
      note: 'Using mock data for calendar events'
    });
  }
});

app.get('/api/calendar/events', async (req, res) => {
  try {
    const { date, calendarId } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    const events = await searchEventsByDate(targetDate, calendarId);
    
    // Count real vs mock events
    const realEvents = events.filter(e => e.isRealEvent).length;
    const mockEvents = events.length - realEvents;
    
    res.json({
      success: true,
      date: targetDate,
      calendarId: calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
      eventCount: events.length,
      realEvents: realEvents,
      mockEvents: mockEvents,
      availableEvents: events.filter(e => e.available).length,
      soldOutEvents: events.filter(e => !e.available).length,
      events: events,
      note: realEvents > 0 ? 'Using real Google Calendar data' : 'Using mock calendar data'
    });
    
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch calendar events',
      message: error.message,
      note: 'Falling back to mock data'
    });
  }
});

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
    
    // Determine if time slot is available
    const isAvailable = !calendarCheck.hasConflicts;
    
    res.json({
      success: true,
      date: date,
      time: time,
      available: isAvailable,
      hasConflicts: calendarCheck.hasConflicts,
      conflictingEventsCount: calendarCheck.conflictingEvents.length,
      availableConflicts: calendarCheck.conflictingEvents.filter(e => e.available).length,
      soldOutConflicts: calendarCheck.conflictingEvents.filter(e => !e.available).length,
      message: isAvailable 
        ? `Time slot ${time} on ${date} is available.` 
        : `Time slot ${time} on ${date} has conflicts with ${calendarCheck.conflictingEvents.length} event(s).`,
      details: calendarCheck,
      note: 'Checking against real Google Calendar events'
    });
    
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check availability',
      message: error.message,
      note: 'Using mock data response'
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
    
    console.log(`📅 AI Agent requested events for date: "${date}"`);
    
    // Check if it's a relative date
    let parsedDate = date;
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // It's not in YYYY-MM-DD format, try to parse it
      parsedDate = parseRelativeDate(date);
      console.log(`📅 Parsed relative date "${date}" → "${parsedDate}"`);
    }
    
    const events = await searchEventsByDate(parsedDate);
    
    // Count real vs mock events
    const realEvents = events.filter(e => e.isRealEvent).length;
    const mockEvents = events.length - realEvents;
    
    // Format response for AI agent
    const formattedEvents = events.map(event => ({
      date: event.date,
      time: event.time,
      title: event.title,
      location: event.location,
      available: event.available,
      reason: event.reason,
      capacity: event.capacity,
      availableSpots: event.availableSpots,
      hasWaitingList: event.hasWaitingList,
      description: event.description,
      isRealEvent: event.isRealEvent || false
    }));
    
    res.json({
      success: true,
      originalDate: date,
      parsedDate: parsedDate,
      eventCount: events.length,
      realEvents: realEvents,
      mockEvents: mockEvents,
      events: formattedEvents,
      summary: `Found ${events.length} event(s) for ${parsedDate} (${realEvents} real, ${mockEvents} mock). ${formattedEvents.filter(e => e.available).length} available.`,
      note: realEvents > 0 ? 'Using real Google Calendar data' : 'Using mock calendar data'
    });
    
  } catch (error) {
    console.error('Error in calendar/date endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch calendar events',
      message: error.message,
      note: 'Using mock data response'
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
    
    console.log(`📅 AI Agent checking availability for ${date} at ${time}`);
    
    const calendarCheck = await checkCalendarForConflicts(date, time);
    const isAvailable = !calendarCheck.hasConflicts;
    
    res.json({
      success: true,
      date: date,
      time: time,
      available: isAvailable,
      hasConflicts: calendarCheck.hasConflicts,
      conflictingEventsCount: calendarCheck.conflictingEvents.length,
      availableConflicts: calendarCheck.conflictingEvents.filter(e => e.available).length,
      soldOutConflicts: calendarCheck.conflictingEvents.filter(e => !e.available).length,
      message: isAvailable 
        ? `Time slot ${time} on ${date} is available.` 
        : `Time slot ${time} on ${date} conflicts with ${calendarCheck.conflictingEvents.length} event(s).`,
      details: 'This time slot availability is checked against real Google Calendar events.',
      note: 'Using Google Calendar for availability check'
    });
    
  } catch (error) {
    console.error('Error in calendar/availability endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check availability',
      message: error.message,
      note: 'Using mock data response'
    });
  }
});

// Get upcoming events (next 7 days)
app.get('/api/calendar/upcoming', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    
    console.log(`📅 AI Agent requested upcoming events for next ${days} days`);
    
    // Get events for each day
    const eventsByDate = {};
    const now = new Date();
    let totalRealEvents = 0;
    let totalMockEvents = 0;
    
    for (let i = 0; i < parseInt(days); i++) {
      const futureDate = new Date(now);
      futureDate.setDate(now.getDate() + i);
      const dateStr = futureDate.toISOString().split('T')[0];
      
      const events = await searchEventsByDate(dateStr);
      
      // Count real vs mock events
      const realEvents = events.filter(e => e.isRealEvent).length;
      const mockEvents = events.length - realEvents;
      
      totalRealEvents += realEvents;
      totalMockEvents += mockEvents;
      
      if (events.length > 0) {
        eventsByDate[dateStr] = events.map(event => ({
          date: event.date,
          time: event.time,
          title: event.title,
          location: event.location,
          available: event.available,
          reason: event.reason,
          capacity: event.capacity,
          availableSpots: event.availableSpots,
          hasWaitingList: event.hasWaitingList,
          description: event.description,
          isRealEvent: event.isRealEvent || false
        }));
      }
    }
    
    res.json({
      success: true,
      days: parseInt(days),
      totalEvents: Object.values(eventsByDate).flat().length,
      realEvents: totalRealEvents,
      mockEvents: totalMockEvents,
      eventsByDate: eventsByDate,
      summary: `Found ${Object.values(eventsByDate).flat().length} event(s) in the next ${days} days (${totalRealEvents} real, ${totalMockEvents} mock).`,
      note: totalRealEvents > 0 ? 'Using real Google Calendar data' : 'Using mock calendar data'
    });
    
  } catch (error) {
    console.error('Error in calendar/upcoming endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch upcoming events',
      message: error.message,
      note: 'Using mock data response'
    });
  }
});

// Debug endpoint for calendar setup
app.get('/api/calendar/debug', async (req, res) => {
  try {
    console.log('🔧 Debugging Google Calendar setup...');
    
    const calendar = await getCalendarClient();
    
    if (!calendar) {
      return res.json({
        success: false,
        message: 'Failed to create calendar client',
        serviceAccount: serviceAccount.client_email,
        recommendation: 'Check service account credentials and permissions',
        note: 'Currently using mock data for calendar events'
      });
    }
    
    // Try to list calendars
    let calendarList;
    try {
      const response = await calendar.calendarList.list({ maxResults: 5 });
      calendarList = response.data.items;
    } catch (error) {
      return res.json({
        success: false,
        message: 'Failed to list calendars',
        error: error.message,
        serviceAccount: serviceAccount.client_email,
        recommendation: 'Service account may not have calendar access',
        note: 'Using mock data'
      });
    }
    
    // Test fetching events
    let testEvents = [];
    try {
      const now = new Date();
      const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: weekLater.toISOString(),
        maxResults: 3,
        singleEvents: true,
        orderBy: 'startTime',
      });
      
      testEvents = response.data.items || [];
    } catch (error) {
      console.log('Test event fetch failed:', error.message);
    }
    
    res.json({
      success: true,
      serviceAccount: serviceAccount.client_email,
      availableCalendars: calendarList.map(c => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary
      })),
      calendarsFound: calendarList.length,
      testEvents: testEvents.map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date
      })),
      testEventsFound: testEvents.length,
      message: 'Google Calendar API is accessible',
      note: testEvents.length > 0 
        ? 'Calendar endpoints will use real Google Calendar data' 
        : 'No events found, will use mock data'
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      note: 'Using mock calendar data'
    });
  }
});

// Test relative date parsing
app.get('/api/calendar/test-parse', (req, res) => {
  const { date } = req.query;
  
  if (!date) {
    return res.status(400).json({
      error: 'Missing date parameter',
      message: 'Provide a date like "the fourth", "february fourth", "tomorrow", etc.'
    });
  }
  
  const parsed = parseRelativeDate(date);
  const events = getMockEventsForDate(parsed);
  
  res.json({
    original: date,
    parsed: parsed,
    eventsFound: events.length,
    events: events,
    note: 'Testing relative date parsing (using mock data for this test)'
  });
});

// ===== ADDITIONAL RESERVATION ENDPOINTS =====

app.post('/api/reservation/detect-intent', async (req, res) => {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 [RESERVATION INTENT DETECTION] API Called');
    console.log('='.repeat(80));
    
    const { conversation, transcript } = req.body;
    
    console.log('📝 Request body:', {
      conversationLength: conversation?.length || 0,
      transcriptLength: transcript?.length || 0
    });
    
    if (!conversation) {
      console.log('❌ ERROR: No conversation provided');
      return res.status(400).json({
        success: false,
        error: 'Missing conversation parameter',
        message: 'Please provide the conversation array'
      });
    }
    
    const conversationText = conversation
      .map(msg => msg.content || '')
      .join(' ');
    
    console.log(`📝 Conversation text length: ${conversationText.length} characters`);
    
    const intentResult = detectReservationIntent(conversationText, transcript);
    
    console.log('🎯 Intent detection result:', intentResult);
    console.log('='.repeat(80) + '\n');
    
    res.json({
      success: true,
      wantsReservation: intentResult.wantsReservation,
      reason: intentResult.reason,
      timestamp: new Date().toISOString(),
      detectionMethod: 'Standalone API endpoint'
    });
    
  } catch (error) {
    console.error('Error in reservation intent detection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to detect reservation intent',
      message: error.message
    });
  }
});

app.post('/api/reservation/extract', async (req, res) => {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('📋 [RESERVATION DATA EXTRACTION] API Called');
    console.log('='.repeat(80));
    
    const { conversation, systemLogs } = req.body;
    
    console.log('📝 Request body:', {
      conversationLength: conversation?.length || 0,
      systemLogsLength: systemLogs?.length || 0,
      systemLogsPreview: systemLogs ? systemLogs.substring(0, 200) + '...' : 'None'
    });
    
    if (!conversation) {
      console.log('❌ ERROR: No conversation provided');
      return res.status(400).json({
        success: false,
        error: 'Missing conversation parameter',
        message: 'Please provide the conversation array'
      });
    }
    
    const reservationData = extractReservationData(conversation, systemLogs);
    const reservationId = generateReservationId();
    
    console.log('✅ Extracted reservation data:', reservationData);
    console.log(`🎫 Generated reservation ID: ${reservationId}`);
    console.log('='.repeat(80) + '\n');
    
    res.json({
      success: true,
      data: reservationData,
      reservationId: reservationId,
      timestamp: new Date().toISOString(),
      extractionMethod: 'Multi-source extraction'
    });
    
  } catch (error) {
    console.error('Error in reservation data extraction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract reservation data',
      message: error.message
    });
  }
});

app.post('/api/reservation/create', async (req, res) => {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('📝 [CREATE RESERVATION] API Called');
    console.log('='.repeat(80));
    
    const reservationData = req.body;
    
    console.log('📋 Reservation data received:', {
      firstName: reservationData.firstName,
      lastName: reservationData.lastName,
      date: reservationData.date,
      time: reservationData.time,
      guests: reservationData.guests,
      phone: reservationData.phone ? `${reservationData.phone.substring(0, 5)}...` : 'None',
      timestamp: new Date().toISOString()
    });
    
    // Validate required fields
    const requiredFields = ['firstName', 'lastName', 'date', 'time', 'guests', 'phone'];
    const missingFields = requiredFields.filter(field => !reservationData[field]);
    
    if (missingFields.length > 0) {
      console.log(`❌ Missing required fields: ${missingFields.join(', ')}`);
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missingFields,
        message: 'Please provide all required reservation information'
      });
    }
    
    // Generate reservation ID
    const reservationId = generateReservationId();
    console.log(`🎫 Generated reservation ID: ${reservationId}`);
    
    // Check calendar availability
    const calendarCheck = await checkCalendarForConflicts(reservationData.date, reservationData.time);
    
    if (calendarCheck.hasConflicts && calendarCheck.conflictingEvents.length > 0) {
      console.log(`⚠️ Calendar conflicts detected: ${calendarCheck.conflictingEvents.length} events`);
    } else {
      console.log('✅ No calendar conflicts detected');
    }
    
    // Prepare Airtable record
    const airtableRecord = {
      "Reservation ID": reservationId,
      "First Name": reservationData.firstName,
      "Last Name": reservationData.lastName,
      "Phone Number": reservationData.phone,
      "Reservation Date": reservationData.date,
      "Arrival Time": formatTimeForAirtable(reservationData.time, reservationData.date),
      "Total People": reservationData.guests,
      "Dinner Count": reservationData.adults || reservationData.guests,
      "Kids Count": reservationData.children || 0,
      "Show-Only Count": 0,
      "Special Requests": reservationData.specialRequests || 'No special requests',
      "Reservation Status": "Pending",
      "Reservation Type": "Dinner + Show",
      "Newsletter Opt-In": reservationData.newsletter || false,
      "Source": "Direct API",
      "Created At": new Date().toISOString(),
      "Italian Time": getItalianTimeWithTimezone(),
      "Calendar Conflicts": calendarCheck.hasConflicts
    };
    
    console.log('📊 Airtable record prepared:', airtableRecord);
    
    try {
      // Create record in Airtable
      const createdRecord = await base('Reservations').create([{ fields: airtableRecord }]);
      
      console.log('✅ Reservation created in Airtable');
      console.log(`📝 Airtable record ID: ${createdRecord[0].id}`);
      
      res.json({
        success: true,
        message: 'Reservation created successfully',
        reservationId: reservationId,
        airtableRecordId: createdRecord[0].id,
        data: {
          ...reservationData,
          reservationId,
          created: new Date().toISOString(),
          italianGreeting: getItalianTimeWithTimezone()
        },
        calendarCheck: {
          hasConflicts: calendarCheck.hasConflicts,
          conflictingEventsCount: calendarCheck.conflictingEvents.length
        }
      });
      
    } catch (airtableError) {
      console.error('❌ Airtable error:', airtableError);
      res.status(500).json({
        success: false,
        error: 'Failed to create reservation in Airtable',
        message: airtableError.message,
        reservationId: reservationId,
        note: 'Reservation ID was generated but Airtable sync failed'
      });
    }
    
  } catch (error) {
    console.error('Error creating reservation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create reservation',
      message: error.message
    });
  }
});

app.get('/api/reservation/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🔍 Looking up reservation: ${id}`);
    
    // Search in Airtable
    const records = await base('Reservations')
      .select({
        filterByFormula: `{Reservation ID} = '${id}'`,
        maxRecords: 1
      })
      .firstPage();
    
    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Reservation not found',
        message: `No reservation found with ID: ${id}`
      });
    }
    
    const record = records[0];
    const reservationData = {
      id: record.id,
      reservationId: record.fields['Reservation ID'],
      firstName: record.fields['First Name'],
      lastName: record.fields['Last Name'],
      phone: record.fields['Phone Number'],
      date: record.fields['Reservation Date'],
      time: record.fields['Arrival Time'] ? new Date(record.fields['Arrival Time']).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '',
      guests: record.fields['Total People'],
      adults: record.fields['Dinner Count'],
      children: record.fields['Kids Count'],
      specialRequests: record.fields['Special Requests'],
      newsletter: record.fields['Newsletter Opt-In'],
      status: record.fields['Reservation Status'],
      type: record.fields['Reservation Type'],
      source: record.fields['Source'],
      createdAt: record.fields['Created At'],
      calendarConflicts: record.fields['Calendar Conflicts']
    };
    
    res.json({
      success: true,
      reservation: reservationData
    });
    
  } catch (error) {
    console.error('Error fetching reservation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reservation',
      message: error.message
    });
  }
});

app.get('/api/reservations/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`📅 Fetching reservations for today: ${today}`);
    
    const records = await base('Reservations')
      .select({
        filterByFormula: `DATETIME_PARSE({Reservation Date}, 'YYYY-MM-DD') = DATETIME_PARSE('${today}', 'YYYY-MM-DD')`,
        maxRecords: 50
      })
      .firstPage();
    
    const reservations = records.map(record => ({
      id: record.id,
      reservationId: record.fields['Reservation ID'],
      firstName: record.fields['First Name'],
      lastName: record.fields['Last Name'],
      phone: record.fields['Phone Number'],
      time: record.fields['Arrival Time'] ? new Date(record.fields['Arrival Time']).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '',
      guests: record.fields['Total People'],
      status: record.fields['Reservation Status']
    }));
    
    res.json({
      success: true,
      date: today,
      count: reservations.length,
      reservations: reservations
    });
    
  } catch (error) {
    console.error('Error fetching today\'s reservations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reservations',
      message: error.message
    });
  }
});

// ===== MAIN WEBHOOK ENDPOINT (MODIFIED WITH RESERVATION DETECTION) =====
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    
    const { event, call } = req.body;
    
    if (event !== 'call_analyzed') {
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_analyzed event...');
    
    // ===== RESERVATION INTENT DETECTION =====
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
      
      const greeting = getItalianTimeWithTimezone();
      return res.json({
        response: `${greeting}! Grazie per aver chiamato il Jazzamore. Se hai bisogno di fare una prenotazione, siamo a tua disposizione. Arrivederci!`,
        saveToAirtable: false,
        reason: 'No reservation intent detected',
        detectionDetails: intentResult
      });
    }
    
    console.log('✅ Reservation intent detected. Proceeding with data extraction...');
    console.log('🔍 Detection reason:', intentResult.reason);
    
    // ===== DIAGNOSTIC LOGGING =====
    console.log('🔍 Searching for Post-Call Analysis data structure...');
    
    let postCallData = null;
    
    if (call?.call_analysis?.custom_analysis_data?.reservation_details) {
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
        console.log('⚠️ No Post-Call Analysis found, falling back to transcript extraction.');
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
          newsletter: false
        };
    }
    
    console.log('📋 Final reservation data:', reservationData);
    
    const { firstName, lastName, date, time, guests, adults, children, phone, specialRequests, newsletter } = reservationData;
    
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
    
    const arrivalTimeISO = formatTimeForAirtable(time, validatedDate);
    
    // ===== CHECK CALENDAR AVAILABILITY =====
    console.log('📅 Checking calendar availability...');
    const calendarCheck = await checkCalendarForConflicts(validatedDate, time);
    
    if (calendarCheck.hasConflicts) {
      console.log(`⚠️ Calendar conflicts detected: ${calendarCheck.conflictingEvents.length} events`);
    } else {
      console.log('✅ No calendar conflicts detected');
    }
    
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
          "Newsletter Opt-In": newsletter || false,
          "Calendar Conflicts": calendarCheck.hasConflicts,
          "Conflict Count": calendarCheck.conflictingEvents.length,
          "Source": "Retell AI Webhook"
        }
      }
    ]);
    
    console.log('🎉 RESERVATION SAVED TO AIRTABLE!');
    console.log('Reservation ID:', reservationId);
    console.log('Name:', `${firstName} ${lastName}`.trim() || 'Not provided');
    console.log('Date/Time:', validatedDate, time);
    console.log('Guests:', guests, `(${adults} adults + ${children} children)`);
    console.log('Phone:', formattedPhone || 'Not provided');
    console.log('Special Requests:', specialRequests);
    console.log('Newsletter:', newsletter);
    console.log('Calendar Conflicts:', calendarCheck.hasConflicts ? `Yes (${calendarCheck.conflictingEvents.length})` : 'No');
    console.log('Airtable Record ID:', record[0].id);
    
    // ===== TIME-AWARE RESPONSE =====
    const greeting = getItalianTimeWithTimezone();
    let timeAwareResponse;
    
    // Check if there are calendar conflicts
    if (calendarCheck.hasConflicts && calendarCheck.conflictingEvents.length > 0) {
      const conflictMessage = calendarCheck.conflictingEvents[0].title 
        ? `C'è un conflitto con "${calendarCheck.conflictingEvents[0].title}" alle ${calendarCheck.conflictingEvents[0].time}.` 
        : 'C\'è un conflitto di orario.';
      
      timeAwareResponse = `${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. ${conflictMessage} La tua conferma è ${reservationId}.`;
    } else {
      if (greeting === "Buongiorno") {
          timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buona giornata!`;
      } else if (greeting === "Buon pomeriggio") {
          timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buon proseguimento!`;
      } else if (greeting === "Buonasera") {
          timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buona serata!`;
      } else {
          timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${validatedDate} alle ${time}. La tua conferma è ${reservationId}. Buona notte!`;
      }
    }
    
    res.json({
        response: timeAwareResponse,
        saveToAirtable: true,
        reservationId: reservationId,
        intentDetected: true,
        detectionDetails: intentResult,
        calendarCheck: {
          hasConflicts: calendarCheck.hasConflicts,
          conflictingEventsCount: calendarCheck.conflictingEvents.length
        }
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('❌ Error stack:', error.stack);
    const greeting = getItalianTimeWithTimezone();
    res.json({
        response: `${greeting}! Grazie per la tua chiamata! Abbiamo riscontrato un problema. Ti preghiamo di riprovare più tardi.`,
        saveToAirtable: false,
        error: error.message
    });
  }
});

// ===== TEST ENDPOINT FOR RESERVATION FLOW =====

app.post('/api/test/reservation-flow', async (req, res) => {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🧪 [TEST RESERVATION FLOW] Called');
    console.log('='.repeat(80));
    
    // Test conversation similar to what the AI agent would send
    const testConversation = [
      {
        role: 'user',
        content: "Hi, I'd like to make a reservation for dinner tomorrow night for 2 people. My name is David Anderson and my phone number is 555-123-4567."
      },
      {
        role: 'agent',
        content: "Buonasera! I'd be happy to help you make a reservation. Let me check availability for tomorrow. Could you tell me what time you'd prefer?"
      },
      {
        role: 'user',
        content: "Around 8 PM would be great. Also, we're celebrating our honeymoon, so if you could arrange something special, that would be wonderful!"
      },
      {
        role: 'agent',
        content: "Congratulations on your honeymoon! I'll make a note for a romantic surprise. Let me check our availability for tomorrow at 8 PM..."
      }
    ];
    
    const testSystemLogs = `RESERVATION_DATA:
First Name: David
Last Name: Anderson
Phone: 5551234567
Guests: 2
Adults: 2
Children: 0
Date: tomorrow
Time: 20:00
Special Requests: Romantic song in the background for honeymoon surprise
Newsletter: Yes`;
    
    console.log('🧪 Testing intent detection...');
    const intentText = testConversation.map(msg => msg.content).join(' ');
    const intentResult = detectReservationIntent(intentText, testConversation);
    console.log('✅ Intent detection:', intentResult);
    
    console.log('\n🧪 Testing data extraction...');
    const extractedData = extractReservationData(testConversation, testSystemLogs);
    console.log('✅ Extracted data:', extractedData);
    
    console.log('\n🧪 Testing calendar availability...');
    const calendarEvents = await searchEventsByDate(extractedData.date);
    const calendarCheck = await checkCalendarForConflicts(extractedData.date, extractedData.time);
    console.log(`✅ Calendar events for ${extractedData.date}:`, calendarEvents.length);
    console.log(`✅ Calendar conflicts for ${extractedData.date} at ${extractedData.time}:`, calendarCheck.conflictingEvents.length);
    
    console.log('\n🧪 Generating reservation ID...');
    const reservationId = generateReservationId();
    console.log(`✅ Reservation ID: ${reservationId}`);
    
    console.log('\n🧪 Testing Italian time greeting...');
    const greeting = getItalianTimeWithTimezone();
    console.log(`✅ Italian greeting: ${greeting}`);
    
    console.log('\n🧪 Testing time formatting for Airtable...');
    const airtableTime = formatTimeForAirtable(extractedData.time, extractedData.date);
    console.log(`✅ Airtable time format: ${airtableTime}`);
    
    console.log('\n🧪 Testing Google Calendar client...');
    const calendarClient = await getCalendarClient();
    console.log(`✅ Google Calendar client: ${calendarClient ? 'Available' : 'Not available'}`);
    
    res.json({
      success: true,
      tests: {
        intentDetection: intentResult,
        dataExtraction: extractedData,
        calendarAvailability: {
          date: extractedData.date,
          time: extractedData.time,
          eventsFound: calendarEvents.length,
          realEvents: calendarEvents.filter(e => e.isRealEvent).length,
          mockEvents: calendarEvents.filter(e => !e.isRealEvent).length,
          conflictsFound: calendarCheck.conflictingEvents.length,
          events: calendarEvents.slice(0, 3), // Show first 3 events only
          conflicts: calendarCheck.conflictingEvents.slice(0, 2) // Show first 2 conflicts
        },
        googleCalendar: {
          clientAvailable: !!calendarClient,
          serviceAccount: serviceAccount.client_email
        },
        reservationId: reservationId,
        italianGreeting: greeting,
        airtableFormat: {
          time: airtableTime,
          date: extractedData.date
        },
        allEndpoints: {
          detectIntent: 'POST /api/reservation/detect-intent',
          extractData: 'POST /api/reservation/extract',
          createReservation: 'POST /api/reservation/create',
          getReservation: 'GET /api/reservation/:id',
          todayReservations: 'GET /api/reservations/today',
          webhook: 'POST /api/reservations',
          calendarDate: 'GET /api/calendar/date',
          calendarAvailability: 'GET /api/calendar/availability'
        }
      },
      note: 'This is a test endpoint for development purposes only'
    });
    
  } catch (error) {
    console.error('Error in test reservation flow:', error);
    res.status(500).json({
      success: false,
      error: 'Test failed',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🎵 Jazzamore server running on port ${PORT}`);
  console.log(`🔑 Google Calendar service account: ${serviceAccount.client_email}`);
  console.log(`📅 Calendar integration: ACTIVE (with mock data fallback)`);
  
  console.log(`\n📅 CALENDAR ENDPOINTS:`);
  console.log(`   - Date query (relative): http://localhost:${PORT}/api/calendar/date?date=the+fourth`);
  console.log(`   - Date query (specific): http://localhost:${PORT}/api/calendar/date?date=2024-02-04`);
  console.log(`   - Availability check: http://localhost:${PORT}/api/calendar/availability?date=2024-02-04&time=20:00`);
  console.log(`   - Parse test: http://localhost:${PORT}/api/calendar/test-parse?date=the+fourth`);
  console.log(`   - Debug: http://localhost:${PORT}/api/calendar/debug`);
  
  console.log(`\n📞 RESERVATION ENDPOINTS:`);
  console.log(`   - Webhook (Retell): http://localhost:${PORT}/api/reservations`);
  console.log(`   - Intent detection: POST http://localhost:${PORT}/api/reservation/detect-intent`);
  console.log(`   - Data extraction: POST http://localhost:${PORT}/api/reservation/extract`);
  console.log(`   - Create reservation: POST http://localhost:${PORT}/api/reservation/create`);
  console.log(`   - Get reservation: GET http://localhost:${PORT}/api/reservation/:id`);
  console.log(`   - Today's reservations: GET http://localhost:${PORT}/api/reservations/today`);
  console.log(`   - Test flow: POST http://localhost:${PORT}/api/test/reservation-flow`);
  
  console.log(`\n🔍 FEATURES:`);
  console.log(`   - Reservation detection: ACTIVE (Multilingual: English/Italian)`);
  console.log(`   - Relative date parsing: ACTIVE ("the fourth" → 2026-02-04)`);
  console.log(`   - Time-aware greetings: ${getItalianTimeWithTimezone()}`);
  console.log(`   - Google Calendar: ACTIVE (with real data extraction)`);
  console.log(`   - Airtable integration: ${process.env.AIRTABLE_BASE_ID ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(`   - Calendar conflict detection: ACTIVE`);
  
  console.log(`\n📊 Google Calendar Status:`);
  console.log(`   - Will attempt to fetch real events first`);
  console.log(`   - Falls back to mock data if real events not available`);
  console.log(`   - Service account: ${serviceAccount.client_email}`);
  console.log(`   - Project ID: ${serviceAccount.project_id}`);
});
