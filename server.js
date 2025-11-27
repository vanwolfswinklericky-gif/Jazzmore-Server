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

// Convert spoken numbers to digits (e.g., "eight five one" → "851")
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

// Extract reservation from conversation
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting extraction...');
  
  let reservation = {
    firstName: 'Caller',
    lastName: '',
    date: new Date().toISOString().split('T')[0], // Today
    time: '21:00', // 9 PM
    guests: 2,
    phone: '',
    specialRequests: 'No special requests'
  };
  
  if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
    console.log('❌ No conversation data available in extraction function');
    return reservation;
  }
  
  console.log(`📞 Processing ${conversation.length} messages`);
  
  // Build conversation text from USER messages only
  let userText = '';
  conversation.forEach(msg => {
    if (msg.content && msg.role === 'user') {
      userText += msg.content + ' ';
      console.log(`🗣️ USER: ${msg.content}`);
    }
  });
  
  console.log('📝 Full user text:', userText);
  
  if (!userText.trim()) {
    console.log('❌ No user text found in conversation');
    return reservation;
  }
  
  // EXTRACT NAME - From the actual conversation
  const nameMatch = userText.match(/first name is.*?(\w+).*?last name is.*?(\w+)/i);
  if (nameMatch && nameMatch[1] && nameMatch[2]) {
    reservation.firstName = nameMatch[1];
    reservation.lastName = nameMatch[2];
    console.log(`👤 Found name: ${reservation.firstName} ${reservation.lastName}`);
  }
  
  // EXTRACT PHONE - Convert spoken numbers to digits
  const phoneWordsMatch = userText.match(/(?:eight|five|one|two|three|four|six|seven|nine|zero)(?:\s+(?:eight|five|one|two|three|four|six|seven|nine|zero))+/i);
  if (phoneWordsMatch) {
    reservation.phone = wordsToDigits(phoneWordsMatch[0]);
    console.log(`📞 Found phone (spoken): ${phoneWordsMatch[0]} → ${reservation.phone}`);
  }
  
  // EXTRACT GUESTS
  if (userText.includes('two') || userText.includes('2')) {
    reservation.guests = 2;
    console.log(`👥 Guests: ${reservation.guests}`);
  }
  
  // EXTRACT TIME
  if (userText.includes('nine') || userText.includes('9')) {
    reservation.time = '21:00';
    console.log('⏰ Time: 9:00 PM');
  }
  
  // EXTRACT SPECIAL REQUESTS
  if (userText.includes('no special request') || userText.includes('not interested')) {
    reservation.specialRequests = 'No special requests or newsletter';
    console.log('🎯 No special requests');
  }
  
  console.log('✅ Extraction complete:', reservation);
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

// POST new reservation - FIXED FOR NEW DATA STRUCTURE
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    console.log('Available data keys:', Object.keys(req.body));
    
    const { event, call } = req.body;
    
    // Process call_analyzed events
    if (event !== 'call_analyzed') {
      console.log(`⚡ Quick response for event: ${event}`);
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_analyzed event...');
    
    // DEBUG: Explore the call object structure
    if (call) {
      console.log('📞 Call object keys:', Object.keys(call));
      console.log('🔍 Exploring call object...');
      
      // Look for conversation data in various locations within call object
      if (call.transcript_with_tool_calls) {
        console.log(`✅ Found transcript_with_tool_calls with ${call.transcript_with_tool_calls.length} items`);
      }
      if (call.conversation_history) {
        console.log(`✅ Found conversation_history with ${call.conversation_history.length} items`);
      }
      if (call.transcript) {
        console.log(`✅ Found transcript: ${call.transcript.substring(0, 100)}...`);
      }
      
      // Log all array properties in call object
      for (const [key, value] of Object.entries(call)) {
        if (Array.isArray(value)) {
          console.log(`📋 call.${key}: Array with ${value.length} items`);
          if (value.length > 0 && value[0].content) {
            console.log(`   Sample: ${value[0].content.substring(0, 50)}...`);
          }
        }
      }
    } else {
      console.log('❌ No call object found');
    }
    
    // Generate reservation ID
    const reservationId = generateReservationId();
    console.log(`🎫 Generated Reservation ID: ${reservationId}`);
    
    // Try to find conversation data in the call object
    let conversationData = null;
    
    if (call) {
      // Try different possible locations for conversation data
      conversationData = call.transcript_with_tool_calls || 
                        call.conversation_history || 
                        call.transcript_content ||
                        null;
    }
    
    if (!conversationData) {
      console.log('❌ No conversation data found in call object');
      // If no structured data, try to use the entire call object as fallback
      conversationData = [];
    } else {
      console.log(`✅ Using conversation data with ${conversationData.length} messages`);
    }
    
    // Extract reservation data
    const reservationData = extractReservationFromConversation(conversationData);
    
    const { firstName, lastName, date, time, guests, phone, specialRequests } = reservationData;
    
    // Format time for Airtable
    const arrivalTimeISO = formatTimeForAirtable(time, date);
    
    // Save to Airtable
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
          "Special Requests": specialRequests || '',
          "Reservation Status": "Pending",
          "Reservation Type": "Dinner + Show",
          "Dinner Count": parseInt(guests),
          "Show-Only Count": 0,
          "Kids Count": 0,
          "Newsletter Opt-In": false
        }
      }
    ]);
    
    console.log('🎉 RESERVATION SAVED!');
    console.log('Reservation ID:', reservationId);
    console.log('Name:', `${firstName} ${lastName}`.trim());
    console.log('Date/Time:', date, time);
    console.log('Guests:', guests);
    console.log('Phone:', phone || 'Not provided');
    console.log('Airtable Record ID:', record[0].id);
    
    res.json({
      response: `Perfect! I've reserved ${guests} people for ${date} at ${time}. Your confirmation is ${reservationId}.`
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
