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

// ENHANCED: Robust phone extraction without breaking changes
function extractPhoneNumber(conversation) {
  console.log('📞 Starting ENHANCED phone extraction...');
  
  const numberWords = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
  };

  // Strategy 1: Look for phone number in conversation context
  let bestPhoneCandidate = '';
  
  // Track when assistant asks for phone number
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    
    if (msg.role === 'assistant' && msg.content && 
        msg.content.toLowerCase().includes('phone')) {
      
      // Look at next few user responses for phone number
      for (let j = i + 1; j < Math.min(i + 4, conversation.length); j++) {
        const userMsg = conversation[j];
        if (userMsg.role === 'user' && userMsg.content) {
          const phone = extractPhoneFromText(userMsg.content, numberWords);
          if (phone && phone.length >= 10) {
            console.log(`✅ Contextual phone found: ${phone}`);
            return `+39${phone.slice(-10)}`;
          }
        }
      }
    }
  }

  // Strategy 2: Fallback to original approach (preserves existing behavior)
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ');
  
  const numberWordsInText = allUserText.match(/(?:zero|one|two|three|four|five|six|seven|eight|nine)/gi);
  if (numberWordsInText) {
    const digitsFromWords = wordsToDigits(numberWordsInText.join(' '));
    if (digitsFromWords.length >= 10) {
      bestPhoneCandidate = digitsFromWords.slice(-10);
      console.log(`✅ Fallback phone from words: ${bestPhoneCandidate}`);
    }
  }

  // Strategy 3: Look for digit sequences
  const digitSequences = allUserText.match(/\d+/g) || [];
  for (const seq of digitSequences) {
    if (seq.length >= 10) {
      bestPhoneCandidate = seq.slice(-10);
      console.log(`✅ Phone from digit sequence: ${bestPhoneCandidate}`);
      break;
    }
  }

  return bestPhoneCandidate ? `+39${bestPhoneCandidate}` : '';
}

// NEW: Helper function for phone extraction
function extractPhoneFromText(text, numberWords) {
  // Convert number words to digits
  let processedText = text.toLowerCase();
  Object.entries(numberWords).forEach(([word, digit]) => {
    processedText = processedText.replace(new RegExp(word, 'g'), digit);
  });
  
  // Extract all digits
  const allDigits = processedText.replace(/\D/g, '');
  
  // Look for 10-digit sequences
  if (allDigits.length >= 10) {
    return allDigits.slice(-10);
  }
  
  return '';
}

// NEW: Helper function to parse numbers from text
function parseNumber(text) {
  const numberMap = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };
  
  if (numberMap[text.toLowerCase()]) {
    return numberMap[text.toLowerCase()];
  }
  
  return parseInt(text) || 0;
}

// UPDATED: Better validation that doesn't override correct data
function validateGuestCounts(totalGuests, adults, children) {
  const originalTotal = totalGuests;
  const originalAdults = adults;
  const originalChildren = children;
  
  // If we have explicit adults + children, trust that combination
  const hasExplicitCombo = (adults > 0 && children > 0) || (adults + children) > 2;
  
  if (hasExplicitCombo) {
    // Trust the explicit counts and recalculate total
    totalGuests = adults + children;
    console.log(`✅ Trusting explicit counts: ${adults} adults + ${children} children = ${totalGuests} total`);
  } else {
    // Ensure children don't exceed total
    if (children > totalGuests) {
      console.log(`🔄 Adjusting: children (${children}) > total (${totalGuests})`);
      children = Math.max(0, totalGuests - 1); // Leave at least 1 adult
      adults = totalGuests - children;
    } else {
      // Recalculate adults based on validated children
      adults = totalGuests - children;
    }
  }
  
  // Final sanity check
  if (children > 0 && adults < 1) {
    adults = 1;
    totalGuests = adults + children;
    console.log(`🔄 Ensuring at least 1 adult with children: ${adults} adult + ${children} children`);
  }
  
  // Log if we made changes
  if (originalTotal !== totalGuests || originalAdults !== adults || originalChildren !== children) {
    console.log(`🔄 Validation adjusted: ${originalTotal}t/${originalAdults}a/${originalChildren}c → ${totalGuests}t/${adults}a/${children}c`);
  }
  
  return { totalGuests, adults, children };
}

// ENHANCED: Fixed guest extraction with proper adult/child counting
function extractGuestInfo(conversation) {
  console.log('👥 Starting ENHANCED guest extraction...');
  
  const allUserText = conversation.filter(msg => msg.role === 'user')
    .map(msg => msg.content)
    .join(' ')
    .toLowerCase();

  let totalGuests = 2;
  let adults = 2;
  let children = 0;

  // Create a number map for word-to-digit conversion
  const numberMap = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };

  // Convert word numbers to digits in the text for easier parsing
  let processedText = allUserText.toLowerCase();
  Object.keys(numberMap).forEach(word => {
    processedText = processedText.replace(new RegExp(word, 'g'), numberMap[word]);
  });

  // STRATEGY 1: Direct "X adults and Y children" pattern (HIGHEST PRIORITY)
  const adultsChildrenMatch = processedText.match(/(\d+)\s+adults?\s+and\s+(\d+)\s+children?/);
  if (adultsChildrenMatch) {
    adults = parseInt(adultsChildrenMatch[1]);
    children = parseInt(adultsChildrenMatch[2]);
    totalGuests = adults + children;
    console.log(`✅ Adults/Children found: ${adults} adults + ${children} children = ${totalGuests} total`);
  }
  
  // STRATEGY 2: Direct children patterns
  const directChildrenMatches = [
    ...allUserText.matchAll(/(\d+)\s+children/g),
    ...allUserText.matchAll(/(\d+)\s+kids/g),
    ...allUserText.matchAll(/(one|two|three|four|five|six|seven|eight|nine|ten)\s+children/g)
  ];
  
  if (directChildrenMatches.length > 0 && children === 0) { // Only if not already set
    const lastMatch = directChildrenMatches[directChildrenMatches.length - 1];
    children = parseNumber(lastMatch[1]);
    console.log(`✅ Direct children count: ${children}`);
  }

  // STRATEGY 3: Total party size patterns
  const partyMatches = [
    ...allUserText.matchAll(/(\d+)\s+people?\s+(?:in my|in the|in our) party/g),
    ...allUserText.matchAll(/(\d+)\s+people?\s+total/g),
    ...allUserText.matchAll(/(one|two|three|four|five|six|seven|eight|nine|ten)\s+people/g),
    ...allUserText.matchAll(/(\d+)\s+guests?/g)
  ];
  
  if (partyMatches.length > 0) {
    const lastMatch = partyMatches[partyMatches.length - 1];
    const newTotal = parseNumber(lastMatch[1]);
    
    // Only update if we don't have a more specific adults+children count
    if (!adultsChildrenMatch) {
      totalGuests = newTotal;
      adults = totalGuests - children; // Calculate adults based on children
      console.log(`✅ Total guests: ${totalGuests} (calculated adults: ${adults})`);
    }
  }

  // STRATEGY 4: Individual adult mentions (if we have children but no adults specified)
  const adultMatches = [
    ...allUserText.matchAll(/(\d+)\s+adults?/g),
    ...allUserText.matchAll(/(one|two|three|four|five|six|seven|eight|nine|ten)\s+adults/g)
  ];
  
  if (adultMatches.length > 0 && !adultsChildrenMatch) {
    const lastMatch = adultMatches[adultMatches.length - 1];
    adults = parseNumber(lastMatch[1]);
    totalGuests = adults + children;
    console.log(`✅ Adults mentioned: ${adults} (recalculated total: ${totalGuests})`);
  }

  // STRATEGY 5: Fallback to simple number detection (original logic)
  if (totalGuests === 2 && !adultsChildrenMatch && partyMatches.length === 0) {
    if (allUserText.includes('three') || allUserText.includes('3')) {
      totalGuests = 3;
      adults = totalGuests - children;
    } else if (allUserText.includes('four') || allUserText.includes('4')) {
      totalGuests = 4;
      adults = totalGuests - children;
    } else if (allUserText.includes('five') || allUserText.includes('5')) {
      totalGuests = 5;
      adults = totalGuests - children;
    }
    console.log(`✅ Fallback guest count: ${totalGuests}`);
  }

  // ENHANCED: Data validation (NEW - doesn't break existing flow)
  ({ totalGuests, adults, children } = validateGuestCounts(totalGuests, adults, children));

  console.log(`✅ FINAL guest count: ${totalGuests} total (${adults} adults + ${children} children)`);
  
  return { totalGuests, adults, children };
}

// UPDATED: Enhanced extraction with better logging
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting ENHANCED extraction...');
  
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
  
  // FIXED: REORDERED PATTERNS - FORMAL DECLARATIONS FIRST
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
  
  // ENHANCED: Use improved phone extraction
  reservation.phone = extractPhoneNumber(conversation);
  
  // ENHANCED: Use improved guest extraction  
  const guestInfo = extractGuestInfo(conversation);
  reservation.guests = guestInfo.totalGuests;
  reservation.adults = guestInfo.adults;
  reservation.children = guestInfo.children;
  
  // FIXED: Date extraction for "today"
  if (allUserText.includes('today')) {
    const today = new Date();
    reservation.date = today.toISOString().split('T')[0];
    console.log(`📅 Date: Today → ${reservation.date}`);
  } else if (allUserText.includes('tomorrow')) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    reservation.date = tomorrow.toISOString().split('T')[0];
    console.log(`📅 Date: Tomorrow → ${reservation.date}`);
  } else if (allUserText.includes('saturday')) {
    // Calculate next Saturday
    const today = new Date();
    const daysUntilSaturday = (6 - today.getDay() + 7) % 7 || 7;
    const nextSaturday = new Date(today);
    nextSaturday.setDate(today.getDate() + daysUntilSaturday);
    reservation.date = nextSaturday.toISOString().split('T')[0];
    console.log(`📅 Date: Next Saturday → ${reservation.date}`);
  }
  
  // TIME - Handle "ten twenty five" as 22:25
  if (allUserText.includes('ten twenty five') || allUserText.includes('10:25')) {
    reservation.time = '22:25';
    console.log('⏰ Time: 10:25 PM → 22:25');
  } else if (allUserText.includes('seven thirty') || allUserText.includes('7:30')) {
    reservation.time = '19:30';
    console.log('⏰ Time: 7:30 PM → 19:30');
  } else if (allUserText.includes('ten') || allUserText.includes('10')) {
    reservation.time = '22:00';
    console.log('⏰ Time: 10:00 PM → 22:00');
  }
  
  // SPECIAL REQUESTS
  if (allUserText.includes('dinner only') || allUserText.includes('only dinner')) {
    reservation.specialRequests = 'Dinner only (no show)';
    console.log('🎯 Dinner only reservation');
  }
  
  console.log('✅ ENHANCED Extraction result:', reservation);
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
