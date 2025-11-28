

const express = require('express');
const Airtable = require('airtable');
const cors = require('cors');

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

// COMPREHENSIVE MULTILINGUAL CONFIGURATION
const MULTILINGUAL_PATTERNS = {
  'english': {
    // Name patterns
    nameRequests: [
      'first name', 'last name', 'your name', 'may i have your name',
      'what is your name', 'could i get your name', 'please tell me your name'
    ],
    namePatterns: [
      /\b(?:my first name is|first name is)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})/i,
      /\b(?:my last name is|last name is)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})/i,
      /\b(?:my name is|name is|i am|it is)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})/i,
    ],
    
    // Guest patterns
    guestPatterns: {
      adultsChildren: /(\d+)\s+(?:adults?)\s+(?:and|,)\s+(\d+)\s+(?:children|kids)/i,
      totalPeople: /(\d+)\s+(?:people|persons|guests)\s+(?:in my|in the|in our)\s+(?:party|group|priority)/i,
      childrenOnly: /(\d+)\s+(?:children|kids)/i,
      adultsOnly: /(\d+)\s+(?:adults?)/i,
      solo: /(?:just me|only me|solo|by myself)/i,
      // Natural language patterns
      family: /(?:me,? my (?:wife|husband)(?:,? and)? my (\d+) (?:children|kids))/i,
      coupleWithKids: /(?:me and my (?:wife|husband)(?: and)? (\d+) (?:children|kids))/i,
      couple: /(?:me and my (?:wife|husband)|my (?:wife|husband) and I)/i
    },
    
    // Date patterns
    datePatterns: {
      today: /\b(?:today|tonight)\b/i,
      tomorrow: /\b(?:tomorrow)\b/i,
      days: {
        sunday: /\b(?:sunday|sun)\b/i,
        monday: /\b(?:monday|mon)\b/i,
        tuesday: /\b(?:tuesday|tue)\b/i,
        wednesday: /\b(?:wednesday|wed)\b/i,
        thursday: /\b(?:thursday|thu)\b/i,
        friday: /\b(?:friday|fri)\b/i,
        saturday: /\b(?:saturday|sat)\b/i
      }
    },
    
    // Time patterns
    timePatterns: {
      seven: /\b(?:seven|7(?:\s*[ap]m?)?)\b/i,
      sevenThirty: /\b(?:seven thirty|7:30|7.30|half past seven)\b/i,
      eight: /\b(?:eight|8(?:\s*[ap]m?)?)\b/i,
      eightThirty: /\b(?:eight thirty|8:30|8.30|half past eight)\b/i,
      nine: /\b(?:nine|9(?:\s*[ap]m?)?)\b/i,
      ten: /\b(?:ten|10(?:\s*[ap]m?)?)\b/i
    },
    
    // Phone patterns
    phoneContext: ['phone', 'number', 'contact', 'reach you'],
    
    // Special requests
    specialRequests: {
      dinnerOnly: /\b(?:dinner only|only dinner|just dinner)\b/i,
      noShow: /\b(?:no show|not for show|just dinner)\b/i
    },
    
    // Number words
    numberWords: {
      'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
      'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
      'ten': '10'
    }
  },
  
  'italian': {
    // Name patterns - Italian
    nameRequests: [
      'nome', 'cognome', 'il tuo nome', 'puoi dirmi il tuo nome',
      'qual è il tuo nome', 'mi dici il tuo nome', 'nome e cognome'
    ],
    namePatterns: [
      /\b(?:il mio nome è|mi chiamo|sono|nome è)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})/i,
      /\b(?:il mio cognome è|cognome è)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})/i,
      /\b(?:mi chiamo|sono)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF'][a-zA-Z\u00C0-\u024F\u0400-\u04FF'\s-]{1,20})/i,
    ],
    
    // Guest patterns - Italian
    guestPatterns: {
      adultsChildren: /(\d+)\s+(?:adulti?)\s+(?:e|,)\s+(\d+)\s+(?:bambini|ragazzi)/i,
      totalPeople: /(\d+)\s+(?:persone|ospiti)\s+(?:nel mio|nella mia|nel nostro)\s+(?:gruppo|partito)/i,
      childrenOnly: /(\d+)\s+(?:bambini|ragazzi)/i,
      adultsOnly: /(\d+)\s+(?:adulti)/i,
      solo: /(?:solo io|soltanto io|da solo|da sola)/i,
      // Natural language patterns
      family: /(?:io,? mia (?:moglie|marito)(?:,? e)? mia (\d+) (?:bambini|figli))/i,
      coupleWithKids: /(?:io e mia (?:moglie|marito)(?: e)? (\d+) (?:bambini|figli))/i,
      couple: /(?:io e (?:mia moglie|mio marito)|siamo in due)/i
    },
    
    // Date patterns - Italian
    datePatterns: {
      today: /\b(?:oggi|stasera|questa sera)\b/i,
      tomorrow: /\b(?:domani|domani sera)\b/i,
      days: {
        sunday: /\b(?:domenica)\b/i,
        monday: /\b(?:lunedì|lunedi)\b/i,
        tuesday: /\b(?:martedì|martedi)\b/i,
        wednesday: /\b(?:mercoledì|mercoledi)\b/i,
        thursday: /\b(?:giovedì|giovedi)\b/i,
        friday: /\b(?:venerdì|venerdi)\b/i,
        saturday: /\b(?:sabato)\b/i
      }
    },
    
    // Time patterns - Italian
    timePatterns: {
      seven: /\b(?:sette|19(?:\s*[.:]?\s*00)?)\b/i,
      sevenThirty: /\b(?:sette e mezzo|7:30|7.30|19:30|19.30)\b/i,
      eight: /\b(?:otto|20(?:\s*[.:]?\s*00)?)\b/i,
      eightThirty: /\b(?:otto e mezzo|8:30|8.30|20:30|20.30)\b/i,
      nine: /\b(?:nove|21(?:\s*[.:]?\s*00)?)\b/i,
      ten: /\b(?:dieci|22(?:\s*[.:]?\s*00)?)\b/i
    },
    
    // Phone patterns - Italian
    phoneContext: ['telefono', 'numero', 'cellulare', 'contatto', 'chiamare'],
    
    // Special requests - Italian
    specialRequests: {
      dinnerOnly: /\b(?:solo cena|soltanto cena|cena solamente)\b/i,
      noShow: /\b(?:niente spettacolo|senza spettacolo|solo per cena)\b/i
    },
    
    // Number words - Italian
    numberWords: {
      'zero': '0', 'uno': '1', 'due': '2', 'tre': '3', 'quattro': '4',
      'cinque': '5', 'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9',
      'dieci': '10'
    }
  }
};

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

// MULTILINGUAL: Language detection
function detectLanguage(conversation) {
  const allText = conversation.map(msg => msg.content).join(' ').toLowerCase();
  
  const italianIndicators = [
    'grazie', 'prego', 'per favore', 'buongiorno', 'buonasera', 'ciao',
    'mi chiamo', 'cognome', 'vorrei', 'prenotazione', 'per stasera',
    'grazie mille', 'perfetto', 'va bene', 'daccordo'
  ];
  
  const englishIndicators = [
    'thank you', 'thanks', 'please', 'hello', 'hi', 'hey',
    'my name is', 'first name', 'last name', 'reservation', 
    'for tonight', 'perfect', 'okay', 'alright'
  ];
  
  const italianCount = italianIndicators.filter(word => allText.includes(word)).length;
  const englishCount = englishIndicators.filter(word => allText.includes(word)).length;
  
  console.log(`🌍 Language detection - Italian: ${italianCount}, English: ${englishCount}`);
  return italianCount > englishCount ? 'italian' : 'english';
}

// MULTILINGUAL: Convert spoken numbers to digits
function wordsToDigits(text, language) {
  const langWords = MULTILINGUAL_PATTERNS[language]?.numberWords || MULTILINGUAL_PATTERNS.english.numberWords;
  let processedText = text.toLowerCase();
  
  // Replace number words
  Object.entries(langWords).forEach(([word, digit]) => {
    processedText = processedText.replace(new RegExp(word, 'g'), digit);
  });
  
  // Extract all digits
  const digits = processedText.replace(/\D/g, '');
  return digits;
}

// ROBUST MULTILINGUAL NAME EXTRACTION
function extractNamesFromConversation(conversation) {
  console.log('🎯 Starting MULTILINGUAL name extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage];
  
  let firstName = '';
  let lastName = '';
  
  const userMessages = conversation.filter(msg => msg.role === 'user').map(msg => msg.content);
  const allUserText = userMessages.join(' ');
  
  console.log('🔍 Raw user text:', allUserText);

  // Clean the text for analysis
  const cleanText = allUserText.replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('🔍 Cleaned text:', cleanText);

  // STRATEGY 1: Direct pattern matching with language-specific patterns
  const nameCandidates = [];
  
  // Apply language-specific patterns
  for (const pattern of patterns.namePatterns) {
    const matches = cleanText.match(pattern);
    if (matches) {
      if (matches[1] && matches[2]) {
        nameCandidates.push(matches[1]);
        nameCandidates.push(matches[2]);
      } else if (matches[1]) {
        nameCandidates.push(matches[1]);
      }
    }
  }
  
  // STRATEGY 2: Standalone capitalized words
  const standaloneNames = cleanText.match(/\b([A-Z][a-z]{2,})\b/g) || [];
  nameCandidates.push(...standaloneNames);

  console.log('🔍 Raw name candidates:', nameCandidates);

  // Filter out common words
  const commonWords = {
    'english': ['hello', 'yes', 'no', 'ok', 'thank', 'please', 'reservation', 'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    'italian': ['ciao', 'si', 'no', 'grazie', 'per favore', 'prenotazione', 'oggi', 'domani', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
  };
  
  const langCommonWords = commonWords[detectedLanguage] || commonWords.english;
  
  const uniqueNames = [...new Set(nameCandidates)].filter(name => 
    name.length >= 2 && 
    !langCommonWords.includes(name.toLowerCase()) &&
    !/^\d+$/.test(name)
  );

  console.log('🔍 Filtered unique names:', uniqueNames);

  // Assign names
  if (uniqueNames.length >= 1) {
    firstName = uniqueNames[0];
    console.log(`✅ First name assigned: ${firstName}`);
  }
  
  if (uniqueNames.length >= 2) {
    for (let i = 1; i < uniqueNames.length; i++) {
      if (uniqueNames[i] !== firstName) {
        lastName = uniqueNames[i];
        console.log(`✅ Last name assigned: ${lastName}`);
        break;
      }
    }
  }

  // STRATEGY 3: Conversation context
  if (!firstName || !lastName) {
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i];
      
      if (msg.role === 'assistant' && msg.content) {
        const content = msg.content.toLowerCase();
        const isNameRequest = patterns.nameRequests.some(pattern => content.includes(pattern));
        
        if (isNameRequest) {
          for (let j = i + 1; j < Math.min(i + 3, conversation.length); j++) {
            const userMsg = conversation[j];
            if (userMsg.role === 'user' && userMsg.content) {
              const nameMatch = userMsg.content.match(/([A-Z][a-z]{2,})/);
              if (nameMatch) {
                if (!firstName) {
                  firstName = nameMatch[1];
                  console.log(`✅ First name from context: ${firstName}`);
                } else if (!lastName) {
                  lastName = nameMatch[1];
                  console.log(`✅ Last name from context: ${lastName}`);
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`🎉 FINAL Names (${detectedLanguage}): "${firstName}" "${lastName}"`);
  return { firstName, lastName };
}

// ROBUST MULTILINGUAL GUEST COUNTING
function extractGuestInfo(conversation) {
  console.log('👥 Starting MULTILINGUAL guest extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage].guestPatterns;
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  console.log('🔍 Guest extraction text:', allUserText);

  let totalGuests = 2;
  let adults = 2;
  let children = 0;

  // Convert word numbers to digits for processing
  let processedText = allUserText;
  const numberWords = MULTILINGUAL_PATTERNS[detectedLanguage].numberWords;
  Object.entries(numberWords).forEach(([word, digit]) => {
    processedText = processedText.replace(new RegExp(word, 'gi'), digit);
  });

  // PATTERN 1: Natural language family patterns
  const familyPattern1 = processedText.match(patterns.family);
  if (familyPattern1) {
    adults = 2;
    children = parseInt(familyPattern1[1]) || 0;
    totalGuests = adults + children;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Family pattern: ${adults} adults + ${children} children = ${totalGuests}`);
  }
  
  // PATTERN 2: Couple with kids
  const familyPattern2 = processedText.match(patterns.coupleWithKids);
  if (familyPattern2) {
    adults = 2;
    children = parseInt(familyPattern2[1]) || 0;
    totalGuests = adults + children;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Couple with kids: ${adults} adults + ${children} children = ${totalGuests}`);
  }
  
  // PATTERN 3: Direct adult/child counts
  const adultsChildrenMatch = processedText.match(patterns.adultsChildren);
  if (adultsChildrenMatch) {
    adults = parseInt(adultsChildrenMatch[1]);
    children = parseInt(adultsChildrenMatch[2]);
    totalGuests = adults + children;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Direct count: ${adults} adults + ${children} children = ${totalGuests}`);
  }
  
  // PATTERN 4: Children only
  const childrenMatch = processedText.match(patterns.childrenOnly);
  if (childrenMatch) {
    children = parseInt(childrenMatch[1]) || 0;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Children detected: ${children}`);
  }

  // PATTERN 5: Total people
  const peopleMatch = processedText.match(patterns.totalPeople);
  if (peopleMatch) {
    totalGuests = parseInt(peopleMatch[1]);
    adults = totalGuests - children;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Total people: ${totalGuests}`);
  }

  // PATTERN 6: Solo traveler
  if (processedText.match(patterns.solo)) {
    totalGuests = 1;
    adults = 1;
    children = 0;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Solo traveler`);
  }

  // PATTERN 7: Couple without kids
  if (processedText.match(patterns.couple)) {
    totalGuests = 2;
    adults = 2;
    children = 0;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Couple`);
  }

  // FINAL VALIDATION
  if (children > 0 && adults < 2) {
    adults = 2;
    totalGuests = adults + children;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Adjusted: minimum 2 adults with children`);
  }

  if (totalGuests < (adults + children)) {
    totalGuests = adults + children;
    console.log(`✅ ${detectedLanguage.toUpperCase()} Recalculated total`);
  }

  console.log(`✅ ${detectedLanguage.toUpperCase()} FINAL: ${totalGuests} total (${adults} adults + ${children} children)`);
  return { totalGuests, adults, children };
}

// MULTILINGUAL PHONE EXTRACTION
function extractPhoneNumber(conversation) {
  console.log('📞 Starting MULTILINGUAL phone extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ');

  // Extract and convert numbers
  const phoneDigits = wordsToDigits(allUserText, detectedLanguage);
  
  if (phoneDigits.length >= 10) {
    const finalPhone = '+39' + phoneDigits.slice(-10);
    console.log(`✅ ${detectedLanguage.toUpperCase()} Phone number: ${finalPhone}`);
    return finalPhone;
  }

  console.log(`❌ ${detectedLanguage.toUpperCase()} No valid phone number found`);
  return '';
}

// MULTILINGUAL DATE/TIME EXTRACTION
function extractDateTime(conversation) {
  console.log('📅 Starting MULTILINGUAL date/time extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage];
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  let time = '22:00';

  // DATE EXTRACTION
  if (allUserText.match(patterns.datePatterns.today)) {
    const today = new Date();
    date = today.toISOString().split('T')[0];
    console.log(`✅ ${detectedLanguage.toUpperCase()} Date: Today → ${date}`);
  } else if (allUserText.match(patterns.datePatterns.tomorrow)) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    date = tomorrow.toISOString().split('T')[0];
    console.log(`✅ ${detectedLanguage.toUpperCase()} Date: Tomorrow → ${date}`);
  } else {
    // Day of week detection
    for (const [day, pattern] of Object.entries(patterns.datePatterns.days)) {
      if (allUserText.match(pattern)) {
        const targetDay = getNextDayOfWeek(day);
        date = targetDay.toISOString().split('T')[0];
        console.log(`✅ ${detectedLanguage.toUpperCase()} Date: ${day} → ${date}`);
        break;
      }
    }
  }

  // TIME EXTRACTION
  const timeMatches = [
    { pattern: patterns.timePatterns.sevenThirty, time: '19:30' },
    { pattern: patterns.timePatterns.seven, time: '19:00' },
    { pattern: patterns.timePatterns.eightThirty, time: '20:30' },
    { pattern: patterns.timePatterns.eight, time: '20:00' },
    { pattern: patterns.timePatterns.nine, time: '21:00' },
    { pattern: patterns.timePatterns.ten, time: '22:00' },
  ];

  for (const match of timeMatches) {
    if (allUserText.match(match.pattern)) {
      time = match.time;
      console.log(`✅ ${detectedLanguage.toUpperCase()} Time: ${time}`);
      break;
    }
  }

  return { date, time };
}

function getNextDayOfWeek(dayName) {
  const days = {
    'sunday': 0, 'domenica': 0,
    'monday': 1, 'lunedì': 1, 'lunedi': 1,
    'tuesday': 2, 'martedì': 2, 'martedi': 2,
    'wednesday': 3, 'mercoledì': 3, 'mercoledi': 3,
    'thursday': 4, 'giovedì': 4, 'giovedi': 4,
    'friday': 5, 'venerdì': 5, 'venerdi': 5,
    'saturday': 6, 'sabato': 6
  };
  
  const today = new Date();
  const targetDay = days[dayName.toLowerCase()];
  const daysUntilTarget = (targetDay - today.getDay() + 7) % 7 || 7;
  
  const nextDay = new Date(today);
  nextDay.setDate(today.getDate() + daysUntilTarget);
  return nextDay;
}

// MULTILINGUAL SPECIAL REQUESTS
function extractSpecialRequests(conversation) {
  const detectedLanguage = detectLanguage(conversation);
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage];
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let specialRequests = 'No special requests';

  if (allUserText.match(patterns.specialRequests.dinnerOnly) || 
      allUserText.match(patterns.specialRequests.noShow)) {
    specialRequests = 'Dinner only (no show)';
    console.log(`✅ ${detectedLanguage.toUpperCase()} Special request: Dinner only`);
  }

  return specialRequests;
}

// MAIN EXTRACTION FUNCTION
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting MULTILINGUAL extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  console.log(`🌍 Primary language: ${detectedLanguage}`);
  
  let reservation = {
    firstName: '',
    lastName: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '22:00',
    guests: 2,
    adults: 2,
    children: 0,
    phone: '',
    specialRequests: 'No special requests'
  };
  
  if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
    console.log('❌ No conversation data available');
    return reservation;
  }
  
  console.log(`📞 Processing ${conversation.length} conversation messages`);
  
  // Collect all user messages
  let userMessages = [];
  conversation.forEach(msg => {
    if (msg.content && msg.role === 'user') {
      userMessages.push(msg.content);
      console.log(`🗣️ USER: "${msg.content}"`);
    }
  });
  
  const allUserText = userMessages.join(' ');
  console.log('📝 ALL User text:', allUserText);
  
  // EXTRACT ALL FIELDS MULTILINGUALLY
  const names = extractNamesFromConversation(conversation);
  reservation.firstName = names.firstName;
  reservation.lastName = names.lastName;
  
  reservation.phone = extractPhoneNumber(conversation);
  
  const guests = extractGuestInfo(conversation);
  reservation.guests = guests.totalGuests;
  reservation.adults = guests.adults;
  reservation.children = guests.children;
  
  const datetime = extractDateTime(conversation);
  reservation.date = datetime.date;
  reservation.time = datetime.time;
  
  reservation.specialRequests = extractSpecialRequests(conversation);
  
  console.log('✅ MULTILINGUAL Extraction result:', reservation);
  return reservation;
}

// Express server routes (same as before)
app.get('/', (req, res) => {
  res.json({ 
    message: '🎵 Jazzamore Server is running!',
    status: 'Ready for reservations'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString()
  });
});

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

app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    
    const { event, call } = req.body;
    
    if (event !== 'call_analyzed') {
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_analyzed event...');
    
    const reservationId = generateReservationId();
    console.log(`🎫 Generated Reservation ID: ${reservationId}`);
    
    let conversationData = [];
    if (call && call.transcript_object) {
      console.log(`✅ Using transcript_object with ${call.transcript_object.length} messages`);
      conversationData = call.transcript_object;
    }
    
    const reservationData = extractReservationFromConversation(conversationData);
    
    const { firstName, lastName, date, time, guests, adults, children, phone, specialRequests } = reservationData;
    
    const arrivalTimeISO = formatTimeForAirtable(time, date);
    
    console.log('💾 Saving to Airtable...');
    const record = await base('Reservations').create([
      {
        "fields": {
          "Reservation ID": reservationId,
          "First Name": firstName,
          "Last Name": lastName || '',
          "Phone Number": phone || '',
          "Reservation Date": date,
          "Arrival Time": arrivalTimeISO,
          "Total People": parseInt(guests),
          "Dinner Count": parseInt(adults),
          "Show-Only Count": 0,
          "Kids Count": parseInt(children),
          "Special Requests": specialRequests || '',
          "Reservation Status": "Pending",
          "Reservation Type": "Dinner + Show",
          "Newsletter Opt-In": false
        }
      }
    ]);
    
    console.log('🎉 RESERVATION SAVED!');
    console.log('Reservation ID:', reservationId);
    console.log('Name:', `${firstName} ${lastName}`.trim());
    console.log('Date/Time:', date, time);
    console.log('Guests:', guests, `(${adults} adults + ${children} children)`);
    console.log('Phone:', phone || 'Not provided');
    console.log('Airtable Record ID:', record[0].id);
    
    res.json({
      response: `Perfect! I've reserved ${guests} people (${adults} adults + ${children} children) for ${date} at ${time}. Your confirmation is ${reservationId}.`
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.json({
      response: "Thank you for your call! We've received your reservation request."
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
});
