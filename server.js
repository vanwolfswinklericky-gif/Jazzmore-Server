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

// Convert spoken numbers to digits
function wordsToDigits(text) {
  const numberWords = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
  };
  
  const words = text.toLowerCase().split(/\s+/);
  let digits = '';
  
  for (const word of words) {
    if (numberWords[word]) {
      digits += numberWords[word];
    }
  }
  
  return digits;
}

// Convert Italian spoken numbers to digits
function wordsToDigitsItalian(text) {
  const numberWords = {
    'zero': '0', 'uno': '1', 'due': '2', 'tre': '3', 'quattro': '4',
    'cinque': '5', 'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9'
  };
  
  const words = text.toLowerCase().split(/\s+/);
  let digits = '';
  
  for (const word of words) {
    if (numberWords[word]) {
      digits += numberWords[word];
    }
  }
  
  return digits;
}

// ENGLISH NAME EXTRACTION
function extractNamesFromConversation(conversation) {
  console.log('🎯 Starting CLEAN name extraction...');
  let firstName = '';
  let lastName = '';

  const userMessages = conversation.filter(msg => msg.role === 'user').map(msg => msg.content);
  const allUserText = userMessages.join(' ');
  console.log('🔍 Raw user text:', allUserText);

  // 1) explicit statements
  const explicitPatterns = [
    /my first name is\s+([A-Z][a-z]+)/i,
    /first name is\s+([A-Z][a-z]+)/i,
    /my name is\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i,
    /i am\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i
  ];
  for (const p of explicitPatterns) {
    const m = allUserText.match(p);
    if (m) {
      firstName = m[1] || '';
      lastName = m[2] || '';
      console.log('✅ Name from explicit pattern:', firstName, lastName);
      return { firstName, lastName };
    }
  }

  // 2) Prefer explicit two-word "First Last"
  const twoWordMatch = allUserText.match(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/);
  if (twoWordMatch) {
    firstName = twoWordMatch[1];
    lastName = twoWordMatch[2];
    console.log('✅ Found two-word name:', firstName, lastName);
    return { firstName, lastName };
  }

  // 3) Single-word fallback but filter common sentence-start or filler tokens
  const filtered = allUserText.replace(/\b(five|four|one|three|two|eight|nine|six|seven|zero)\b/gi, '');
  const capitalizedWords = filtered.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  console.log('🔍 Capitalized words (no numbers):', capitalizedWords);

  const stopwords = new Set(['hello','yes','no','ok','thank','thanks','alright','make','this','that','only','just']);
  const potentialNames = capitalizedWords.filter(w => !stopwords.has(w.toLowerCase()));
  console.log('🔍 Potential names after filtering:', potentialNames);

  if (potentialNames.length >= 2) {
    firstName = potentialNames[0];
    // pick next distinct that looks like a surname
    for (let i = 1; i < potentialNames.length; i++) {
      if (potentialNames[i] !== firstName) { lastName = potentialNames[i]; break; }
    }
  } else if (potentialNames.length === 1) {
    firstName = potentialNames[0];
  }

  console.log(`🎉 FINAL Names: "${firstName}" "${lastName}"`);
  return { firstName, lastName };
}

// ITALIAN NAME EXTRACTION
function extractNamesFromConversationItalian(conversation) {
  console.log('🎯 Starting Italian name extraction...');
  let firstName = '';
  let lastName = '';

  const userMessages = conversation.filter(msg => msg.role === 'user').map(msg => msg.content);
  const allUserText = userMessages.join(' ');
  console.log('🔍 Testo utente:', allUserText);

  // 1) Pattern espliciti italiani
  const explicitPatterns = [
    /mi chiamo\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i,
    /il mio nome è\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i,
    /sono\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/i,
    /mi chiamo\s+([A-Z][a-z]+)/i,
    /nome\s+([A-Z][a-z]+)/i,
    /cognome\s+([A-Z][a-z]+)/i
  ];
  for (const p of explicitPatterns) {
    const m = allUserText.match(p);
    if (m) {
      firstName = m[1] || '';
      lastName = m[2] || '';
      console.log('✅ Nome da pattern italiano:', firstName, lastName);
      return { firstName, lastName };
    }
  }

  // 2) Preferire due parole "Nome Cognome"
  const twoWordMatch = allUserText.match(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/);
  if (twoWordMatch) {
    firstName = twoWordMatch[1];
    lastName = twoWordMatch[2];
    console.log('✅ Trovato nome di due parole:', firstName, lastName);
    return { firstName, lastName };
  }

  // 3) Fallback a una parola con filtraggio parole comuni
  const filtered = allUserText.replace(/\b(uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\b/gi, '');
  const capitalizedWords = filtered.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  console.log('🔍 Parole capitalizzate (senza numeri):', capitalizedWords);

  const stopwords = new Set(['ciao','si','no','ok','grazie','per','vorrei','allora','quindi','buongiorno','buonasera','perfetto','va','bene']);
  const potentialNames = capitalizedWords.filter(w => !stopwords.has(w.toLowerCase()));
  console.log('🔍 Nomi potenziali dopo filtraggio:', potentialNames);

  if (potentialNames.length >= 2) {
    firstName = potentialNames[0];
    // scegli il prossimo distinto che sembra un cognome
    for (let i = 1; i < potentialNames.length; i++) {
      if (potentialNames[i] !== firstName) { lastName = potentialNames[i]; break; }
    }
  } else if (potentialNames.length === 1) {
    firstName = potentialNames[0];
  }

  console.log(`🎉 Nomi FINALI: "${firstName}" "${lastName}"`);
  return { firstName, lastName };
}

// ENGLISH GUEST COUNTING
function extractGuestInfo(conversation) {
  console.log('👥 Starting guest extraction...');
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();
  console.log('🔍 Guest extraction text:', allUserText);

  // safer default = 1 (assume solo unless stated)
  let totalGuests = 1;
  let adults = 1;
  let children = 0;

  // explicit phrases for solo
  if (allUserText.includes('just me') ||
      allUserText.includes('only me') ||
      allUserText.includes('for myself') ||
      allUserText.includes('myself') ||
      allUserText.includes('alone')) {
    totalGuests = 1; adults = 1; children = 0;
    console.log('✅ Solo pattern matched');
    return { totalGuests, adults, children };
  }

  // couple patterns
  if (allUserText.includes('just me and my girlfriend') || allUserText.includes('me and my girlfriend') ||
      allUserText.includes('me and my wife') || allUserText.includes('me and my husband')) {
    totalGuests = 2; adults = 2; children = 0;
    console.log('✅ Couple pattern: 2 people');
    return { totalGuests, adults, children };
  }

  // family with children: "me my wife and 2 children" etc.
  let m;
  if ((m = allUserText.match(/me,? my (?:wife|husband)(?:,? and)? (?:my )?(\d+)\s+(?:children|kids)/))) {
    children = parseInt(m[1]) || 0;
    adults = 2;
    totalGuests = adults + children;
    console.log(`✅ Family pattern: ${totalGuests}`);
    return { totalGuests, adults, children };
  }

  // explicit counts: "3 people" or "3 adults and 1 child"
  if ((m = allUserText.match(/(\d+)\s+people/))) {
    totalGuests = parseInt(m[1]);
    adults = totalGuests;
    console.log('✅ Total people pattern:', totalGuests);
    return { totalGuests, adults, children };
  }
  if ((m = allUserText.match(/(\d+)\s+adults?\s+and\s+(\d+)\s+children?/))) {
    adults = parseInt(m[1]); children = parseInt(m[2]);
    totalGuests = adults + children;
    console.log('✅ Adults/children pattern:', totalGuests);
    return { totalGuests, adults, children };
  }

  // fallback: look for spoken digit words "two", "three" etc.
  const wordToNum = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
  const words = allUserText.split(/\W+/);
  const nums = words.map(w => wordToNum[w]).filter(n => typeof n === 'number' && n > 0);
  if (nums.length) {
    totalGuests = Math.max(...nums);
    adults = totalGuests;
    console.log('✅ Word-number fallback:', totalGuests);
    return { totalGuests, adults, children };
  }

  console.log(`✅ FINAL: ${totalGuests} total (${adults} adults + ${children} children)`);
  return { totalGuests, adults, children };
}

// ITALIAN GUEST COUNTING
function extractGuestInfoItalian(conversation) {
  console.log('👥 Starting Italian guest extraction...');
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();
  console.log('🔍 Testo per estrazione ospiti:', allUserText);

  // default più sicuro = 1 (singolo a meno che non specificato)
  let totalGuests = 1;
  let adults = 1;
  let children = 0;

  // frasi esplicite per singolo
  if (allUserText.includes('solo io') ||
      allUserText.includes('solo per me') ||
      allUserText.includes('soltanto io') ||
      allUserText.includes('da solo') ||
      allUserText.includes('per me')) {
    totalGuests = 1; adults = 1; children = 0;
    console.log('✅ Pattern singolo riconosciuto');
    return { totalGuests, adults, children };
  }

  // pattern coppia
  if (allUserText.includes('io e mia moglie') || allUserText.includes('io e mio marito') ||
      allUserText.includes('io e la mia ragazza') || allUserText.includes('io e il mio ragazzo') ||
      allUserText.includes('io e mia moglie') || allUserText.includes('io e mio marito')) {
    totalGuests = 2; adults = 2; children = 0;
    console.log('✅ Pattern coppia: 2 persone');
    return { totalGuests, adults, children };
  }

  // famiglia con bambini: "io, mia moglie e 2 bambini" etc.
  let m;
  if ((m = allUserText.match(/io,? (?:mia )?(?:moglie|marito|ragazza|ragazzo)(?:,? e)? (\d+) (?:bambini|figli)/))) {
    children = parseInt(m[1]) || 0;
    adults = 2;
    totalGuests = adults + children;
    console.log(`✅ Pattern famiglia: ${totalGuests}`);
    return { totalGuests, adults, children };
  }

  // conteggi espliciti: "3 persone" o "3 adulti e 1 bambino"
  if ((m = allUserText.match(/(\d+)\s+persone/))) {
    totalGuests = parseInt(m[1]);
    adults = totalGuests;
    console.log('✅ Pattern persone totali:', totalGuests);
    return { totalGuests, adults, children };
  }
  if ((m = allUserText.match(/(\d+)\s+adulti?\s+e\s+(\d+)\s+bambini?/))) {
    adults = parseInt(m[1]); children = parseInt(m[2]);
    totalGuests = adults + children;
    console.log('✅ Pattern adulti/bambini:', totalGuests);
    return { totalGuests, adults, children };
  }

  // fallback: cerca parole numeriche "due", "tre" etc.
  const wordToNum = { zero:0, uno:1, due:2, tre:3, quattro:4, cinque:5, sei:6, sette:7, otto:8, nove:9, dieci:10 };
  const words = allUserText.split(/\W+/);
  const nums = words.map(w => wordToNum[w]).filter(n => typeof n === 'number' && n > 0);
  if (nums.length) {
    totalGuests = Math.max(...nums);
    adults = totalGuests;
    console.log('✅ Fallback parole-numero:', totalGuests);
    return { totalGuests, adults, children };
  }

  console.log(`✅ FINALE: ${totalGuests} totali (${adults} adulti + ${children} bambini)`);
  return { totalGuests, adults, children };
}

// ENGLISH PHONE EXTRACTION
function extractPhoneNumber(conversation) {
  console.log('📞 Starting phone extraction...');
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  // Convert number words to digits first
  const numberWords = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
  };

  let processedText = allUserText;
  Object.entries(numberWords).forEach(([word, digit]) => {
    processedText = processedText.replace(new RegExp(word, 'g'), digit);
  });

  // Extract all digits
  const allDigits = processedText.replace(/\D/g, '');
  console.log('🔍 All digits found:', allDigits);

  // Look for phone number patterns (10+ digits)
  if (allDigits.length >= 10) {
    const phoneNumber = '+39' + allDigits.slice(-10);
    console.log(`✅ Phone number extracted: ${phoneNumber}`);
    return phoneNumber;
  }

  console.log('❌ No valid phone number found');
  return '';
}

// ITALIAN PHONE EXTRACTION
function extractPhoneNumberItalian(conversation) {
  console.log('📞 Starting Italian phone extraction...');
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  // Converti parole numeriche in cifre
  const numberWords = {
    'zero': '0', 'uno': '1', 'due': '2', 'tre': '3', 'quattro': '4',
    'cinque': '5', 'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9'
  };

  let processedText = allUserText;
  Object.entries(numberWords).forEach(([word, digit]) => {
    processedText = processedText.replace(new RegExp(word, 'g'), digit);
  });

  // Estrai tutte le cifre
  const allDigits = processedText.replace(/\D/g, '');
  console.log('🔍 Tutte le cifre trovate:', allDigits);

  // Cerca pattern di numeri di telefono (10+ cifre)
  if (allDigits.length >= 10) {
    const phoneNumber = '+39' + allDigits.slice(-10);
    console.log(`✅ Numero di telefono estratto: ${phoneNumber}`);
    return phoneNumber;
  }

  console.log('❌ Nessun numero di telefono valido trovato');
  return '';
}

// ENGLISH DATE AND TIME EXTRACTION
function extractDateTime(conversation) {
  console.log('📅 Starting date/time extraction...');
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Default tomorrow
  let time = '22:00'; // Default 10 PM

  // DATE EXTRACTION
  if (allUserText.includes('today')) {
    const today = new Date();
    date = today.toISOString().split('T')[0];
    console.log(`✅ Date: Today → ${date}`);
  } else if (allUserText.includes('tomorrow')) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    date = tomorrow.toISOString().split('T')[0];
    console.log(`✅ Date: Tomorrow → ${date}`);
  } else if (allUserText.includes('monday')) {
    // Calculate next Monday
    const today = new Date();
    const daysUntilMonday = (1 - today.getDay() + 7) % 7 || 7;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    date = nextMonday.toISOString().split('T')[0];
    console.log(`✅ Date: Next Monday → ${date}`);
  }

  // TIME EXTRACTION
  if (allUserText.includes('seven') || allUserText.includes('7')) {
    if (allUserText.includes('thirty') || allUserText.includes('30')) {
      time = '19:30';
      console.log('✅ Time: 7:30 PM');
    } else {
      time = '19:00';
      console.log('✅ Time: 7:00 PM');
    }
  } else if (allUserText.includes('eight') || allUserText.includes('8')) {
    if (allUserText.includes('thirty') || allUserText.includes('30')) {
      time = '20:30';
      console.log('✅ Time: 8:30 PM');
    } else {
      time = '20:00';
      console.log('✅ Time: 8:00 PM');
    }
  } else if (allUserText.includes('nine') || allUserText.includes('9')) {
    time = '21:00';
    console.log('✅ Time: 9:00 PM');
  } else if (allUserText.includes('ten') || allUserText.includes('10')) {
    time = '22:00';
    console.log('✅ Time: 10:00 PM');
  }

  return { date, time };
}

// ITALIAN DATE AND TIME EXTRACTION
function extractDateTimeItalian(conversation) {
  console.log('📅 Starting Italian date/time extraction...');
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Default domani
  let time = '22:00'; // Default 22:00

  // ESTRAZIONE DATA
  if (allUserText.includes('oggi')) {
    const today = new Date();
    date = today.toISOString().split('T')[0];
    console.log(`✅ Data: Oggi → ${date}`);
  } else if (allUserText.includes('domani')) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    date = tomorrow.toISOString().split('T')[0];
    console.log(`✅ Data: Domani → ${date}`);
  } else if (allUserText.includes('lunedì') || allUserText.includes('lunedi')) {
    // Calcola prossimo lunedì
    const today = new Date();
    const daysUntilMonday = (1 - today.getDay() + 7) % 7 || 7;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    date = nextMonday.toISOString().split('T')[0];
    console.log(`✅ Data: Prossimo lunedì → ${date}`);
  }

  // ESTRAZIONE ORARIO
  if (allUserText.includes('sette') || allUserText.includes('7')) {
    if (allUserText.includes('trenta') || allUserText.includes('mezza')) {
      time = '19:30';
      console.log('✅ Orario: 19:30');
    } else {
      time = '19:00';
      console.log('✅ Orario: 19:00');
    }
  } else if (allUserText.includes('otto') || allUserText.includes('8')) {
    if (allUserText.includes('trenta') || allUserText.includes('mezza')) {
      time = '20:30';
      console.log('✅ Orario: 20:30');
    } else {
      time = '20:00';
      console.log('✅ Orario: 20:00');
    }
  } else if (allUserText.includes('nove') || allUserText.includes('9')) {
    time = '21:00';
    console.log('✅ Orario: 21:00');
  } else if (allUserText.includes('dieci') || allUserText.includes('10')) {
    time = '22:00';
    console.log('✅ Orario: 22:00');
  }

  return { date, time };
}

// ENGLISH SPECIAL REQUESTS EXTRACTION
function extractSpecialRequests(conversation) {
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let specialRequests = 'No special requests';

  if (allUserText.includes('dinner only') || allUserText.includes('only dinner')) {
    specialRequests = 'Dinner only (no show)';
    console.log('✅ Special request: Dinner only');
  }

  return specialRequests;
}

// ITALIAN SPECIAL REQUESTS EXTRACTION
function extractSpecialRequestsItalian(conversation) {
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  let specialRequests = 'Nessuna richiesta speciale';

  if (allUserText.includes('solo cena') || allUserText.includes('cena solamente')) {
    specialRequests = 'Solo cena (no spettacolo)';
    console.log('✅ Richiesta speciale: Solo cena');
  }

  return specialRequests;
}

// DETECT LANGUAGE AND USE APPROPRIATE EXTRACTION
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting EXTRACTION...');
  
  // Detect language from conversation
  const allText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();
  
  const isItalian = allText.includes('ciao') || allText.includes('grazie') || allText.includes('perfetto') || 
                   allText.includes('vorrei') || allText.includes('prenotare') || allText.includes('grazie');
  
  console.log(`🌍 Language detected: ${isItalian ? 'Italian' : 'English'}`);
  
  let reservation = {
    firstName: '',
    lastName: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '22:00',
    guests: 2,
    adults: 2,
    children: 0,
    phone: '',
    specialRequests: isItalian ? 'Nessuna richiesta speciale' : 'No special requests'
  };
  
  if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
    console.log('❌ No conversation data available');
    return reservation;
  }
  
  console.log(`📞 Processing ${conversation.length} conversation messages`);
  
  // Use appropriate language functions
  if (isItalian) {
    const names = extractNamesFromConversationItalian(conversation);
    reservation.firstName = names.firstName;
    reservation.lastName = names.lastName;
    
    reservation.phone = extractPhoneNumberItalian(conversation);
    
    const guests = extractGuestInfoItalian(conversation);
    reservation.guests = guests.totalGuests;
    reservation.adults = guests.adults;
    reservation.children = guests.children;
    
    const datetime = extractDateTimeItalian(conversation);
    reservation.date = datetime.date;
    reservation.time = datetime.time;
    
    reservation.specialRequests = extractSpecialRequestsItalian(conversation);
  } else {
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
  }
  
  console.log('✅ FINAL Extraction result:', reservation);
  return reservation;
}

// Express server routes
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
