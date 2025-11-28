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
      solo: /(?:just me|only me|solo|by myself)/i
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
      solo: /(?:solo io|soltanto io|da solo|da sola)/i
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
    }
  }
};

// NATURAL LANGUAGE PATTERNS FOR ADVANCED UNDERSTANDING
const NATURAL_LANGUAGE_PATTERNS = {
  'english': {
    guestPatterns: {
      family: /(?:me,? my (?:wife|husband)(?:,? and)? (\d+) (?:kids?|children))/i,
      coupleWithKids: /(?:my (?:wife|husband) and I(?:,? and)? (\d+) (?:kids?|children))/i,
      solo: /(?:just me|only me|solo|by myself|just myself)/i,
      couple: /(?:me and my (?:wife|husband)|my (?:wife|husband) and I|we are two|a couple)/i,
      group: /(?:group of (\d+)|(\d+) of us|\d+\s*(?:people|friends))/i
    },
    timePatterns: {
      halfPast: /(?:half past|thirty past)\s+(\d+)/i,
      quarterPast: /(?:quarter past|fifteen past)\s+(\d+)/i,
      quarterTo: /(?:quarter to|fifteen to)\s+(\d+)/i,
      morning: /(\d+)\s*(?:am|in the morning)/i,
      evening: /(\d+)\s*(?:pm|in the evening|at night)/i
    }
  },
  'italian': {
    guestPatterns: {
      family: /(?:io,? mia (?:moglie|marito)(?:,? e)? (\d+) (?:bambini|figli))/i,
      coupleWithKids: /(?:io e mia (?:moglie|marito)(?:,? e)? (\d+) (?:bambini|figli))/i,
      solo: /(?:solo io|soltanto io|da solo|da sola)/i,
      couple: /(?:io e (?:mia moglie|mio marito)|siamo in due|una coppia)/i,
      group: /(?:gruppo di (\d+)|\d+\s*(?:persone|amici))/i
    },
    timePatterns: {
      halfPast: /(?:e mezzo|mezza)\s+(\d+)/i,
      quarterPast: /(?:e un quarto|\d+\s*e quindici)/i,
      quarterTo: /(?:meno un quarto|\d+\s*meno quindici)/i,
      morning: /(\d+)\s*(?:di mattina|mattina)/i,
      evening: /(\d+)\s*(?:di sera|sera|pomeriggio)/i
    }
  }
};

// CONVERSATION STATE TRACKING FOR CORRECTION HANDLING
class ConversationState {
  constructor() {
    this.currentField = null;
    this.extractedData = {
      firstName: '',
      lastName: '',
      guests: { total: 0, adults: 0, children: 0 },
      date: '',
      time: '',
      phone: ''
    };
    this.correctionHistory = [];
  }

  updateState(assistantMessage, userResponse) {
    const content = assistantMessage.toLowerCase();
    
    // Track what field we're asking for
    if (content.includes('first name') || content.includes('nome')) {
      this.currentField = 'firstName';
    } else if (content.includes('last name') || content.includes('cognome')) {
      this.currentField = 'lastName';
    } else if (content.includes('phone') || content.includes('telefono')) {
      this.currentField = 'phone';
    } else if (content.includes('people') || content.includes('persone')) {
      this.currentField = 'guests';
    } else if (content.includes('date') || content.includes('data')) {
      this.currentField = 'date';
    } else if (content.includes('time') || content.includes('ora')) {
      this.currentField = 'time';
    }

    // Process user response
    this.processUserResponse(userResponse);
  }

  processUserResponse(userResponse) {
    if (!this.currentField) return;

    const response = userResponse.toLowerCase();
    
    // Detect corrections
    const isCorrection = response.match(/\b(?:actually|sorry|correction|correct|no,?|wait|scusa|correggo|aspetta)\b/i);
    
    if (isCorrection) {
      this.correctionHistory.push({
        field: this.currentField,
        previous: this.extractedData[this.currentField],
        new: userResponse,
        timestamp: new Date()
      });
      console.log(`🔄 Correction detected for ${this.currentField}`);
    }

    // Extract data based on current field
    switch (this.currentField) {
      case 'firstName':
        const firstName = extractFirstName(userResponse);
        if (firstName) this.extractedData.firstName = firstName;
        break;
      case 'lastName':
        const lastName = extractLastName(userResponse);
        if (lastName) this.extractedData.lastName = lastName;
        break;
      case 'guests':
        const guests = extractGuestInfoFromText(userResponse);
        if (guests) this.extractedData.guests = guests;
        break;
      case 'phone':
        const phone = extractPhoneFromResponse(userResponse);
        if (phone) this.extractedData.phone = phone;
        break;
    }
  }

  getFinalData() {
    return this.extractedData;
  }
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
  return italianCount >= englishCount ? 'italian' : 'english';
}

// MULTILINGUAL: Convert spoken numbers to digits
function wordsToDigits(text, language) {
  const numberWords = {
    'english': {
      'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
      'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
      'ten': '10', 'double': '', 'triple': ''
    },
    'italian': {
      'zero': '0', 'uno': '1', 'due': '2', 'tre': '3', 'quattro': '4',
      'cinque': '5', 'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9',
      'dieci': '10', 'doppio': '', 'doppia': '', 'triplo': '', 'tripla': ''
    }
  };

  const langWords = numberWords[language] || numberWords.english;
  let processedText = text.toLowerCase();
  
  // Replace number words
  Object.entries(langWords).forEach(([word, digit]) => {
    processedText = processedText.replace(new RegExp(word, 'g'), digit);
  });
  
  // Extract all digits
  const digits = processedText.replace(/\D/g, '');
  return digits;
}

// ENHANCED: Natural language guest counting
function extractGuestsNaturalLanguage(text, language) {
  const patterns = NATURAL_LANGUAGE_PATTERNS[language]?.guestPatterns;
  if (!patterns) return null;

  let adults = 0;
  let children = 0;

  // Family patterns: "me, my wife and 2 kids"
  const familyMatch = text.match(patterns.family);
  if (familyMatch) {
    adults = 2; // Assuming couple
    children = parseInt(familyMatch[1]) || 0;
    return { adults, children, total: adults + children };
  }

  // Couple with kids: "my wife and I and 2 children"
  const coupleKidsMatch = text.match(patterns.coupleWithKids);
  if (coupleKidsMatch) {
    adults = 2;
    children = parseInt(coupleKidsMatch[1]) || 0;
    return { adults, children, total: adults + children };
  }

  // Solo: "just me"
  if (text.match(patterns.solo)) {
    return { adults: 1, children: 0, total: 1 };
  }

  // Couple: "me and my wife"
  if (text.match(patterns.couple)) {
    return { adults: 2, children: 0, total: 2 };
  }

  // Group: "group of 5"
  const groupMatch = text.match(patterns.group);
  if (groupMatch) {
    const total = parseInt(groupMatch[1]) || parseInt(groupMatch[2]) || 0;
    return { adults: total, children: 0, total };
  }

  return null;
}

// ENHANCED: Complex time parsing
function parseComplexTimeExpression(text, language) {
  const patterns = NATURAL_LANGUAGE_PATTERNS[language]?.timePatterns;
  if (!patterns) return null;

  let hour = 0;
  let minute = 0;
  let isPM = false;

  // Half past: "half past eight" → 20:30
  const halfPastMatch = text.match(patterns.halfPast);
  if (halfPastMatch) {
    hour = parseInt(halfPastMatch[1]);
    minute = 30;
    isPM = hour < 12; // Assume PM for evening times
  }

  // Quarter past: "quarter past seven" → 19:15
  const quarterPastMatch = text.match(patterns.quarterPast);
  if (quarterPastMatch) {
    hour = parseInt(quarterPastMatch[1]);
    minute = 15;
    isPM = hour < 12;
  }

  // Quarter to: "quarter to nine" → 20:45
  const quarterToMatch = text.match(patterns.quarterTo);
  if (quarterToMatch) {
    hour = parseInt(quarterToMatch[1]) - 1;
    minute = 45;
    isPM = hour < 12;
  }

  // Time of day indicators
  if (text.match(patterns.evening)) {
    isPM = true;
  }

  // Convert to 24-hour format
  if (isPM && hour < 12) hour += 12;
  if (hour === 12 && !isPM) hour = 0; // Midnight

  if (hour > 0) {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }

  return null;
}

// MULTILINGUAL: Name extraction
function extractNamesFromConversation(conversation) {
  console.log('🎯 Starting MULTILINGUAL name extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage];
  
  let firstName = '';
  let lastName = '';
  let nameCandidates = [];

  // Strategy 1: Conversation flow analysis
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    
    if (msg.role === 'assistant' && msg.content) {
      const content = msg.content.toLowerCase();
      const isNameRequest = patterns.nameRequests.some(pattern => content.includes(pattern));
      
      if (isNameRequest) {
        console.log(`🗣️ Name request detected in ${detectedLanguage}: "${msg.content}"`);
        
        for (let j = i + 1; j < Math.min(i + 4, conversation.length); j++) {
          const userMsg = conversation[j];
          if (userMsg.role === 'user' && userMsg.content) {
            const extracted = extractNameFromResponse(userMsg.content, detectedLanguage);
            if (extracted) {
              nameCandidates.push(extracted);
              console.log(`✅ Name candidate: ${JSON.stringify(extracted)}`);
            }
          }
        }
      }
    }
  }

  // Strategy 2: Pattern matching
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ');

  for (const pattern of patterns.namePatterns) {
    const match = allUserText.match(pattern);
    if (match) {
      console.log(`🔍 Name pattern matched: ${pattern.source} →`, match);
      if (match[1] && match[2]) {
        nameCandidates.push({ first: cleanName(match[1]), last: cleanName(match[2]) });
      } else if (match[1]) {
        if (pattern.source.includes('nome') || pattern.source.includes('first')) {
          nameCandidates.push({ first: cleanName(match[1]) });
        } else if (pattern.source.includes('cognome') || pattern.source.includes('last')) {
          nameCandidates.push({ last: cleanName(match[1]) });
        }
      }
    }
  }

  // Process candidates
  if (nameCandidates.length > 0) {
    const bestCandidate = nameCandidates.find(c => c.first && c.last) || nameCandidates[0];
    firstName = bestCandidate.first || '';
    lastName = bestCandidate.last || '';
    
    if (nameCandidates.length > 1) {
      const firstCandidate = nameCandidates.find(c => c.first);
      const lastCandidate = nameCandidates.find(c => c.last);
      if (firstCandidate) firstName = firstCandidate.first;
      if (lastCandidate) lastName = lastCandidate.last;
    }
  }

  console.log(`🎉 FINAL Names (${detectedLanguage}): ${firstName} ${lastName}`);
  return { firstName, lastName };
}

function extractNameFromResponse(text, language) {
  const cleanText = text.replace(/[?!.,]/g, '').trim();
  const singleWord = cleanText.match(/^([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})$/);
  
  if (singleWord) return { first: singleWord[1] };
  
  if (language === 'italian') {
    const italianPattern = cleanText.match(/^(?:mi chiamo|sono|il mio nome è)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})$/i);
    if (italianPattern) return { first: italianPattern[1] };
    
    const twoWords = cleanText.match(/^(?:mi chiamo|sono)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})$/i);
    if (twoWords) return { first: twoWords[1], last: twoWords[2] };
  } else {
    const englishPattern = cleanText.match(/^(?:my name is|i am|it is)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})$/i);
    if (englishPattern) return { first: englishPattern[1] };
    
    const twoWords = cleanText.match(/^(?:my name is|i am)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})$/i);
    if (twoWords) return { first: twoWords[1], last: twoWords[2] };
  }
  
  return null;
}

// Helper functions for state tracking
function extractFirstName(text) {
  const match = text.match(/^(?:my name is|i am|mi chiamo|sono)\s+([a-zA-Z\u00C0-\u024F\u0400-\u04FF']{2,})/i);
  return match ? cleanName(match[1]) : cleanName(text);
}

function extractLastName(text) {
  return cleanName(text);
}

function extractGuestInfoFromText(text) {
  const detectedLanguage = detectLanguage([{ role: 'user', content: text }]);
  const naturalResult = extractGuestsNaturalLanguage(text, detectedLanguage);
  return naturalResult || { total: 2, adults: 2, children: 0 };
}

function extractPhoneFromResponse(text) {
  const detectedLanguage = detectLanguage([{ role: 'user', content: text }]);
  const digits = wordsToDigits(text, detectedLanguage);
  return digits.length >= 10 ? `+39${digits.slice(-10)}` : '';
}

function cleanName(name) {
  return name ? name.replace(/[?!.,]/g, '').trim() : '';
}

// MULTILINGUAL: Phone extraction
function extractPhoneNumber(conversation) {
  console.log('📞 Starting MULTILINGUAL phone extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage];
  
  let bestPhoneCandidate = '';

  // Strategy 1: Conversation context
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    
    if (msg.role === 'assistant' && msg.content) {
      const content = msg.content.toLowerCase();
      const isPhoneRequest = patterns.phoneContext.some(pattern => content.includes(pattern));
      
      if (isPhoneRequest) {
        console.log(`📱 Phone request detected in ${detectedLanguage}`);
        
        for (let j = i + 1; j < Math.min(i + 4, conversation.length); j++) {
          const userMsg = conversation[j];
          if (userMsg.role === 'user' && userMsg.content) {
            const phoneDigits = wordsToDigits(userMsg.content, detectedLanguage);
            if (phoneDigits.length >= 10) {
              bestPhoneCandidate = phoneDigits.slice(-10);
              console.log(`✅ Contextual phone found: ${bestPhoneCandidate}`);
              return `+39${bestPhoneCandidate}`;
            }
          }
        }
      }
    }
  }

  // Strategy 2: Extract from all conversation
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ');
  
  const phoneDigits = wordsToDigits(allUserText, detectedLanguage);
  if (phoneDigits.length >= 10) {
    bestPhoneCandidate = phoneDigits.slice(-10);
    console.log(`✅ Phone from all text: ${bestPhoneCandidate}`);
  }

  return bestPhoneCandidate ? `+39${bestPhoneCandidate}` : '';
}

// ENHANCED GUEST COUNTING WITH NATURAL LANGUAGE
function extractAdvancedGuestInfo(conversation) {
  console.log('👥 Starting ADVANCED guest extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ');

  let totalGuests = 2;
  let adults = 2;
  let children = 0;

  // Step 1: Try natural language first
  const naturalResult = extractGuestsNaturalLanguage(allUserText, detectedLanguage);
  if (naturalResult) {
    console.log(`✅ Natural language guests: ${JSON.stringify(naturalResult)}`);
    return naturalResult;
  }

  // Step 2: Try structured patterns
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage].guestPatterns;
  
  // Expanded pattern matching
  const adultsChildrenMatch = allUserText.match(patterns.adultsChildren);
  if (adultsChildrenMatch) {
    adults = parseInt(adultsChildrenMatch[1]);
    children = parseInt(adultsChildrenMatch[2]);
    totalGuests = adults + children;
  } else {
    // Individual component extraction
    const childrenMatch = allUserText.match(patterns.childrenOnly);
    const adultsMatch = allUserText.match(patterns.adultsOnly);
    const totalMatch = allUserText.match(patterns.totalPeople);

    if (childrenMatch) children = parseInt(childrenMatch[1]);
    if (adultsMatch) adults = parseInt(adultsMatch[1]);
    if (totalMatch) totalGuests = parseInt(totalMatch[1]);

    // Reconcile totals
    if (totalGuests === 2 && (adults > 2 || children > 0)) {
      totalGuests = adults + children;
    } else if (totalGuests > 2) {
      adults = totalGuests - children;
    }
  }

  // Step 3: Solo traveler check
  if (allUserText.match(patterns.solo)) {
    totalGuests = 1;
    adults = 1;
    children = 0;
  }

  // Step 4: Validation
  ({ totalGuests, adults, children } = validateGuestCounts(totalGuests, adults, children));
  
  console.log(`✅ Advanced guest extraction: ${totalGuests} total (${adults} adults + ${children} children)`);
  
  return { totalGuests, adults, children };
}

function validateGuestCounts(totalGuests, adults, children) {
  if (children > totalGuests) {
    children = Math.max(0, totalGuests - 1);
    adults = totalGuests - children;
  } else {
    adults = totalGuests - children;
  }
  
  if (children > 0 && adults < 1) {
    adults = 1;
    totalGuests = adults + children;
  }
  
  return { totalGuests, adults, children };
}

// ENHANCED: Complex time extraction
function extractComplexTime(conversation) {
  const detectedLanguage = detectLanguage(conversation);
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let time = '22:00'; // Default

  // Try complex time expressions first
  const complexTime = parseComplexTimeExpression(allUserText, detectedLanguage);
  if (complexTime) {
    console.log(`✅ Complex time expression: ${complexTime}`);
    return complexTime;
  }

  // Fallback to basic time patterns
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage].timePatterns;
  
  // Expanded time matching with priority
  const timeMatches = [
    { pattern: patterns.sevenThirty, time: '19:30' },
    { pattern: patterns.seven, time: '19:00' },
    { pattern: patterns.eightThirty, time: '20:30' },
    { pattern: patterns.eight, time: '20:00' },
    { pattern: patterns.nine, time: '21:00' },
    { pattern: patterns.ten, time: '22:00' },
  ];

  for (const match of timeMatches) {
    if (allUserText.match(match.pattern)) {
      time = match.time;
      console.log(`✅ Basic time pattern: ${time}`);
      break;
    }
  }

  return time;
}

// MULTILINGUAL: Date extraction
function extractDateTime(conversation) {
  console.log('📅 Starting MULTILINGUAL date/time extraction...');
  
  const detectedLanguage = detectLanguage(conversation);
  const patterns = MULTILINGUAL_PATTERNS[detectedLanguage];
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Default tomorrow

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

  return { date, time: extractComplexTime(conversation) };
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

// MULTILINGUAL: Special requests extraction
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

// MAIN EXTRACTION FUNCTION WITH ALL ENHANCEMENTS
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting ULTIMATE extraction with all enhancements...');
  
  const detectedLanguage = detectLanguage(conversation);
  console.log(`🌍 Primary language: ${detectedLanguage}`);
  
  // Initialize conversation state for correction tracking
  const state = new ConversationState();
  
  // Process conversation with state tracking
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    
    if (msg.role === 'assistant') {
      const nextUserMsg = conversation[i + 1];
      if (nextUserMsg && nextUserMsg.role === 'user') {
        state.updateState(msg.content, nextUserMsg.content);
      }
    }
  }

  const stateData = state.getFinalData();
  
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
  
  // EXTRACT ALL FIELDS WITH ENHANCED METHODS
  // Use state data when available, fallback to pattern matching
  reservation.firstName = stateData.firstName || extractNamesFromConversation(conversation).firstName;
  reservation.lastName = stateData.lastName || extractNamesFromConversation(conversation).lastName;
  
  reservation.phone = stateData.phone || extractPhoneNumber(conversation);
  
  const guests = stateData.guests.total ? stateData.guests : extractAdvancedGuestInfo(conversation);
  reservation.guests = guests.totalGuests || guests.total;
  reservation.adults = guests.adults;
  reservation.children = guests.children;
  
  const datetime = extractDateTime(conversation);
  reservation.date = datetime.date;
  reservation.time = datetime.time;
  
  reservation.specialRequests = extractSpecialRequests(conversation);

  // Log corrections for debugging
  if (state.correctionHistory.length > 0) {
    console.log('📝 Correction history:', state.correctionHistory);
  }

  console.log('✅ ULTIMATE Extraction result:', reservation);
  return reservation;
}

// Express server routes (unchanged)
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
