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

// CLEAN NAME EXTRACTION - Separates names from phone numbers
function extractNamesFromConversation(conversation) {
  console.log('🎯 Starting CLEAN name extraction...');
  
  let firstName = '';
  let lastName = '';
  
  const userMessages = conversation.filter(msg => msg.role === 'user').map(msg => msg.content);
  const allUserText = userMessages.join(' ');
  
  console.log('🔍 Raw user text:', allUserText);

  // STRATEGY 1: Look for explicit name declarations FIRST
  const explicitPatterns = [
    // "My first name is Paul"
    /my first name is\s+([A-Z][a-z]+)/i,
    // "First name is Paul"  
    /first name is\s+([A-Z][a-z]+)/i,
    // "My name is Paul"
    /my name is\s+([A-Z][a-z]+)/i,
    // "I am Paul"
    /i am\s+([A-Z][a-z]+)/i
  ];

  for (const pattern of explicitPatterns) {
    const match = allUserText.match(pattern);
    if (match && match[1]) {
      firstName = match[1];
      console.log(`✅ First name from explicit pattern: ${firstName}`);
      break;
    }
  }

  // STRATEGY 2: Conversation context - look for responses to name questions
  if (!firstName) {
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i];
      
      if (msg.role === 'assistant' && msg.content && 
          (msg.content.toLowerCase().includes('first name') || 
           msg.content.toLowerCase().includes('your name'))) {
        
        // Look at the NEXT user response only
        const nextUserMsg = conversation[i + 1];
        if (nextUserMsg && nextUserMsg.role === 'user' && nextUserMsg.content) {
          const content = nextUserMsg.content.trim();
          
          // Extract just the first capitalized word (ignore phone numbers)
          const nameMatch = content.match(/^([A-Z][a-z]{2,})[?!.]?$/);
          if (nameMatch) {
            const potentialName = nameMatch[1];
            // Only filter out the most basic words
            if (!['yes', 'no', 'ok', 'hello'].includes(potentialName.toLowerCase())) {
              firstName = potentialName;
              console.log(`✅ First name from conversation: ${firstName}`);
              break;
            }
          }
        }
      }
    }
  }

  // STRATEGY 3: Look for last name in conversation context
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    
    if (msg.role === 'assistant' && msg.content && 
        msg.content.toLowerCase().includes('last name')) {
      
      // Look at the NEXT user response only
      const nextUserMsg = conversation[i + 1];
      if (nextUserMsg && nextUserMsg.role === 'user' && nextUserMsg.content && firstName) {
        const content = nextUserMsg.content.trim();
        
        // Extract just the first capitalized word
        const nameMatch = content.match(/^([A-Z][a-z]{2,})[?!.]?$/);
        if (nameMatch) {
          const potentialName = nameMatch[1];
          if (!['yes', 'no', 'ok'].includes(potentialName.toLowerCase())) {
            lastName = potentialName;
            console.log(`✅ Last name from conversation: ${lastName}`);
            break;
          }
        }
      }
    }
  }

  // STRATEGY 4: Fallback - find standalone capitalized words that are NOT in phone number context
  if (!firstName || !lastName) {
    // Remove phone number patterns first to avoid contamination
    const textWithoutNumbers = allUserText.replace(/(?:five|four|one|three|two|eight|\d)/gi, '');
    
    const capitalizedWords = textWithoutNumbers.match(/\b[A-Z][a-z]{2,}\b/g) || [];
    console.log('🔍 Capitalized words (no numbers):', capitalizedWords);
    
    // Filter out obvious non-names
    const obviousNonNames = ['hello', 'yes', 'no', 'ok', 'thank', 'good', 'just', 'woah', 'not'];
    const potentialNames = capitalizedWords.filter(word => 
      !obviousNonNames.includes(word.toLowerCase())
    );
    
    console.log('🔍 Potential names after filtering:', potentialNames);
    
    if (potentialNames.length >= 2 && !firstName && !lastName) {
      // Take the first two distinct names
      firstName = potentialNames[0];
      for (let i = 1; i < potentialNames.length; i++) {
        if (potentialNames[i] !== firstName) {
          lastName = potentialNames[i];
          break;
        }
      }
      console.log(`✅ Names from fallback: ${firstName} ${lastName}`);
    } else if (potentialNames.length >= 1 && !firstName) {
      firstName = potentialNames[0];
      console.log(`✅ First name from fallback: ${firstName}`);
    }
  }

  console.log(`🎉 FINAL Names: "${firstName}" "${lastName}"`);
  return { firstName, lastName };
}

// ROBUST GUEST COUNTING
function extractGuestInfo(conversation) {
  console.log('👥 Starting guest extraction...');
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content).join(' ').toLowerCase();

  console.log('🔍 Guest extraction text:', allUserText);

  let totalGuests = 2;
  let adults = 2;
  let children = 0;

  // PATTERN 1: "just me and my girlfriend" = 2 people
  if (allUserText.includes('just me and my girlfriend') || allUserText.includes('me and my girlfriend')) {
    totalGuests = 2;
    adults = 2;
    children = 0;
    console.log(`✅ Couple pattern: 2 people (me + girlfriend)`);
  }
  // PATTERN 2: "me and my wife" = 2 people
  else if (allUserText.includes('me and my wife') || allUserText.includes('me and my husband')) {
    totalGuests = 2;
    adults = 2;
    children = 0;
    console.log(`✅ Couple pattern: 2 people`);
  }
  // PATTERN 3: "just me" = 1 person
  else if (allUserText.includes('just me')) {
    totalGuests = 1;
    adults = 1;
    children = 0;
    console.log(`✅ Solo pattern: 1 person`);
  }
  // PATTERN 4: "me, my wife, and X children" = 2 + X people
  else if (allUserText.match(/me,? my (?:wife|husband)(?:,? and)? my (\d+) (?:children|kids)/)) {
    const match = allUserText.match(/me,? my (?:wife|husband)(?:,? and)? my (\d+) (?:children|kids)/);
    adults = 2;
    children = parseInt(match[1]) || 0;
    totalGuests = adults + children;
    console.log(`✅ Family pattern: ${adults} adults + ${children} children = ${totalGuests}`);
  }
  // PATTERN 5: Direct counts
  else if (allUserText.match(/(\d+)\s+people/)) {
    const peopleMatch = allUserText.match(/(\d+)\s+people/);
    totalGuests = parseInt(peopleMatch[1]);
    adults = totalGuests;
    console.log(`✅ Total people: ${totalGuests}`);
  }
  // PATTERN 6: Adults and children
  else if (allUserText.match(/(\d+)\s+adults?\s+and\s+(\d+)\s+children?/)) {
    const match = allUserText.match(/(\d+)\s+adults?\s+and\s+(\d+)\s+children?/);
    adults = parseInt(match[1]);
    children = parseInt(match[2]);
    totalGuests = adults + children;
    console.log(`✅ Adults/children: ${adults} + ${children} = ${totalGuests}`);
  }
  // PATTERN 7: Simple number detection as fallback
  else {
    const numbers = allUserText.match(/\d+/g) || [];
    const possibleCounts = numbers.map(n => parseInt(n)).filter(n => n > 0 && n <= 20);
    
    if (possibleCounts.length > 0) {
      totalGuests = Math.max(...possibleCounts);
      adults = totalGuests;
      console.log(`✅ Number fallback: ${totalGuests} guests`);
    }
  }

  console.log(`✅ FINAL: ${totalGuests} total (${adults} adults + ${children} children)`);
  return { totalGuests, adults, children };
}

// ROBUST PHONE EXTRACTION
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

// DATE AND TIME EXTRACTION
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

// SPECIAL REQUESTS EXTRACTION
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

// MAIN EXTRACTION FUNCTION
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting EXTRACTION...');
  
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
  
  // EXTRACT ALL FIELDS
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
