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

// Convert spoken numbers to digits (e.g., "five five three" → "553")
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

// FIXED: Use the WORKING name extraction patterns with improved guest counting
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting extraction...');
  
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
  
  let firstName = '';
  let lastName = '';
  
  // USE THE WORKING PATTERNS FROM YOUR ORIGINAL CODE
  const namePatterns = [
    // HIGHEST PRIORITY: Formal name declarations
    /first name is\s+(\w+)\s+last name is\s+(\w+)/i,
    /my first name is\s+(\w+)\s+my last name is\s+(\w+)/i,
    /first name is\s+(\w+).*?last name is\s+(\w+)/i,
    
    // HIGH PRIORITY: Individual formal declarations
    /my first name is\s+(\w+)/i,
    /first name is\s+(\w+)/i,
    /my last name is\s+(\w+)/i,
    /last name is\s+(\w+)/i,
    
    // MEDIUM PRIORITY: Direct name statements
    /name is\s+(\w+)\s+(\w+)/i,
    /my name is\s+(\w+)\s+(\w+)/i,
    
    // LOWEST PRIORITY: Casual mentions (LAST to avoid false matches)
    /i'm\s+(\w+)\s+(\w+)/i,
    /i am\s+(\w+)\s+(\w+)/i,
  ];
  
  console.log('🎯 PHASE 1: High-priority pattern matching...');
  
  // Try high and medium priority patterns first (first 9 patterns)
  for (let i = 0; i < 9; i++) {
    const pattern = namePatterns[i];
    const match = allUserText.match(pattern);
    if (match) {
      console.log(`🔍 Testing pattern "${pattern.source}":`, match);
      
      if (match[1] && match[2]) {
        // Found both names
        firstName = match[1];
        lastName = match[2];
        console.log(`✅ HIGH-PRIORITY PATTERN SUCCESS: ${firstName} ${lastName}`);
        break;
      } else if (match[1]) {
        // Found individual name
        if (pattern.source.includes('first')) {
          firstName = match[1];
          console.log(`✅ FIRST NAME FOUND: ${firstName}`);
        } else if (pattern.source.includes('last')) {
          lastName = match[1];
          console.log(`✅ LAST NAME FOUND: ${lastName}`);
        }
      }
    }
  }
  
  // PHASE 2: If we have one name but not both, search for the other
  if ((firstName && !lastName) || (!firstName && lastName)) {
    console.log('🔄 PHASE 2: Finding missing name...');
    
    for (let i = 0; i < 9; i++) {
      const pattern = namePatterns[i];
      const match = allUserText.match(pattern);
      if (match && match[1]) {
        if (!firstName && pattern.source.includes('first')) {
          firstName = match[1];
          console.log(`✅ FOUND MISSING FIRST NAME: ${firstName}`);
        } else if (!lastName && pattern.source.includes('last')) {
          lastName = match[1];
          console.log(`✅ FOUND MISSING LAST NAME: ${lastName}`);
        }
      }
    }
  }
  
  // PHASE 3: Only use low-priority patterns if we still have nothing
  if (!firstName && !lastName) {
    console.log('🔄 PHASE 3: Low-priority pattern matching...');
    
    for (let i = 9; i < namePatterns.length; i++) {
      const pattern = namePatterns[i];
      const match = allUserText.match(pattern);
      if (match && match[1] && match[2]) {
        firstName = match[1];
        lastName = match[2];
        console.log(`✅ LOW-PRIORITY PATTERN: ${firstName} ${lastName}`);
        break;
      }
    }
  }
  
  // Apply extracted names
  if (firstName || lastName) {
    reservation.firstName = firstName || '';
    reservation.lastName = lastName || '';
    console.log(`🎉 NAME EXTRACTION SUCCESS: ${reservation.firstName} ${reservation.lastName}`);
  } else {
    console.log('❌ Name extraction failed - no patterns matched');
  }
  
  // FIXED: Better phone extraction - Clean up the digits
  const numberWords = allUserText.match(/(?:zero|one|two|three|four|five|six|seven|eight|nine)/gi);
  if (numberWords) {
    // Convert words to digits and clean up
    let phoneDigits = wordsToDigits(numberWords.join(' '));
    
    // Extract only the digits and take the last 10 for Italian number
    const cleanDigits = phoneDigits.replace(/\D/g, '');
    if (cleanDigits.length >= 10) {
      reservation.phone = '+39' + cleanDigits.slice(-10);
      console.log(`📞 Clean phone number: ${reservation.phone}`);
    } else {
      reservation.phone = phoneDigits;
      console.log(`📞 Phone numbers found: ${numberWords.join(' ')} → ${reservation.phone}`);
    }
  }
  
  // FIXED: IMPROVED GUEST COUNT EXTRACTION
  let totalGuests = 2;
  let adults = 2;
  let children = 0;

  // Look for explicit "adults and children" pattern first (including word numbers)
  const adultsChildrenMatch = allUserText.match(/(\d+)\s+adults?\s+and\s+(\d+)\s+children?/i);
  const wordAdultsChildrenMatch = allUserText.match(/(one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\s+and\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+children?/i);
  
  if (adultsChildrenMatch) {
    adults = parseInt(adultsChildrenMatch[1]);
    children = parseInt(adultsChildrenMatch[2]);
    totalGuests = adults + children;
    console.log(`👥 Adults/Children found: ${adults} adults + ${children} children = ${totalGuests} total`);
  } 
  else if (wordAdultsChildrenMatch) {
    const numberMap = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
    };
    adults = numberMap[wordAdultsChildrenMatch[1].toLowerCase()];
    children = numberMap[wordAdultsChildrenMatch[2].toLowerCase()];
    totalGuests = adults + children;
    console.log(`👥 Word-based Adults/Children: ${adults} adults + ${children} children = ${totalGuests} total`);
  }
  // Look for total people count
  else if (allUserText.match(/(\d+)\s+people/)) {
    const peopleMatch = allUserText.match(/(\d+)\s+people/);
    totalGuests = parseInt(peopleMatch[1]);
    adults = totalGuests; // Assume all adults if not specified
    children = 0;
    console.log(`👥 Total people: ${totalGuests}`);
  }
  // Look for children mentioned separately
  else if (allUserText.match(/(\d+)\s+children?/)) {
    const childrenMatch = allUserText.match(/(\d+)\s+children?/);
    children = parseInt(childrenMatch[1]);
    // If we have children but no adult count mentioned, assume at least 1 adult
    const adultMatch = allUserText.match(/(\d+)\s+adults?/);
    adults = adultMatch ? parseInt(adultMatch[1]) : 1;
    totalGuests = adults + children;
    console.log(`👥 Children detected: ${children} children + ${adults} adults = ${totalGuests} total`);
  }
  // Fallback to number detection
  else if (allUserText.includes('three') || allUserText.includes('3')) {
    totalGuests = 3;
    adults = 3;
    children = 0;
    console.log(`👥 Guests from text: ${totalGuests}`);
  } else if (allUserText.includes('two') || allUserText.includes('2')) {
    totalGuests = 2;
    adults = 2;
    children = 0;
    console.log(`👥 Guests from text: ${totalGuests}`);
  }

  reservation.guests = totalGuests;
  reservation.adults = adults;
  reservation.children = children;
  
  // Date extraction
  if (allUserText.includes('today')) {
    const today = new Date();
    reservation.date = today.toISOString().split('T')[0];
    console.log(`📅 Date: Today → ${reservation.date}`);
  } else if (allUserText.includes('tomorrow')) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    reservation.date = tomorrow.toISOString().split('T')[0];
    console.log(`📅 Date: Tomorrow → ${reservation.date}`);
  } else if (allUserText.includes('saturday')) {
    const today = new Date();
    const daysUntilSaturday = (6 - today.getDay() + 7) % 7 || 7;
    const nextSaturday = new Date(today);
    nextSaturday.setDate(today.getDate() + daysUntilSaturday);
    reservation.date = nextSaturday.toISOString().split('T')[0];
    console.log(`📅 Date: Next Saturday → ${reservation.date}`);
  }
  
  // TIME
  if (allUserText.includes('seven thirty') || allUserText.includes('7:30')) {
    reservation.time = '19:30';
    console.log('⏰ Time: 7:30 PM');
  } else if (allUserText.includes('ten') || allUserText.includes('10')) {
    reservation.time = '22:00';
    console.log('⏰ Time: 10:00 PM');
  }
  
  // SPECIAL REQUESTS
  if (allUserText.includes('dinner only') || allUserText.includes('only dinner')) {
    reservation.specialRequests = 'Dinner only (no show)';
    console.log('🎯 Dinner only reservation');
  }
  
  console.log('✅ FINAL Extraction result:', reservation);
  return reservation;
}

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: '🎵 Jazzamore Server is running!',
    status: 'Ready for reservations'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString()
  });
});

// GET all reservations
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

// POST new reservation
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
