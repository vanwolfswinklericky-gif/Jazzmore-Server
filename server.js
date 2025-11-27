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

// FIXED: Handle empty conversation gracefully
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting extraction...');
  
  let reservation = {
    firstName: 'Caller',
    lastName: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '19:30',
    guests: 2,
    phone: '',
    specialRequests: 'Reservation from phone call'
  };
  
  if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
    console.log('📝 No conversation data available, using defaults');
    return reservation;
  }
  
  console.log(`📞 Processing ${conversation.length} conversation messages`);
  
  // Build conversation text from USER messages only
  let userText = '';
  conversation.forEach(msg => {
    if (msg.content && msg.role === 'user') {
      userText += msg.content + ' ';
      console.log(`🗣️ USER: ${msg.content}`);
    }
  });
  
  console.log('📝 Full user text:', userText);
  
  const text = userText.toLowerCase();
  
  // FIXED: Better name extraction with first/last name separation
  const namePatterns = [
    /my name is (\w+) (\w+)/i,
    /i'm (\w+) (\w+)/i, 
    /i am (\w+) (\w+)/i,
    /this is (\w+) (\w+)/i,
    /for (\w+) (\w+)/i,
    /under (\w+) (\w+)/i,
    /name (\w+) (\w+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = userText.match(pattern);
    if (match && match[1] && match[2]) {
      reservation.firstName = match[1];
      reservation.lastName = match[2];
      console.log(`👤 Found full name: ${reservation.firstName} ${reservation.lastName}`);
      break;
    }
  }
  
  // If no full name, try single name
  if (!reservation.firstName) {
    const singleMatch = userText.match(/(?:my name is|i'm|i am|this is) (\w+)/i);
    if (singleMatch) {
      reservation.firstName = singleMatch[1];
      console.log(`👤 Found first name only: ${reservation.firstName}`);
    }
  }
  
  // FIXED: Better phone extraction
  const phonePatterns = [
    /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/,
    /phone.*?(\d{10})/i,
    /number.*?(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/i
  ];
  
  for (const pattern of phonePatterns) {
    const match = userText.match(pattern);
    if (match && match[1]) {
      reservation.phone = match[1].replace(/[^\d]/g, '');
      console.log(`📞 Found phone: ${reservation.phone}`);
      break;
    }
  }
  
  // Date extraction
  if (text.includes('tomorrow')) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    reservation.date = tomorrow.toISOString().split('T')[0];
    console.log('📅 Date: tomorrow');
  }
  
  // Time extraction
  if (text.includes('twelve') || text.includes('12')) {
    reservation.time = '12:00';
  } else if (text.includes('seven') || text.includes('7')) {
    reservation.time = '19:00';
  } else if (text.includes('eight') || text.includes('8')) {
    reservation.time = '20:00';
  }
  
  // Guest extraction
  const guestMatch = text.match(/(\d+)\s*people/);
  if (guestMatch) {
    reservation.guests = parseInt(guestMatch[1]);
    console.log(`👥 Guests: ${reservation.guests}`);
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

// POST new reservation - DEBUG VERSION
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('=== FULL REQUEST ANALYSIS ===');
    console.log('Event:', req.body.event);
    console.log('Call ID:', req.body.call_id);
    console.log('All body keys:', Object.keys(req.body));
    
    // Log ALL data from Retell to see what's available
    for (const [key, value] of Object.entries(req.body)) {
      if (Array.isArray(value)) {
        console.log(`📋 ${key}: Array with ${value.length} items`);
        if (value.length > 0 && value.length <= 5) {
          console.log(`   Sample items:`, JSON.stringify(value.slice(0, 3), null, 2));
        } else if (value.length > 5) {
          console.log(`   First 3 items:`, JSON.stringify(value.slice(0, 3), null, 2));
          console.log(`   ... and ${value.length - 3} more items`);
        }
      } else if (typeof value === 'string') {
        if (value.length > 100) {
          console.log(`📝 ${key}: ${value.substring(0, 100)}... [${value.length} chars total]`);
        } else {
          console.log(`📝 ${key}: ${value}`);
        }
      } else {
        console.log(`🔧 ${key}:`, value);
      }
    }
    console.log('=== END REQUEST ANALYSIS ===\n');
    
    const { event, conversation_history, transcript, call_id } = req.body;
    
    if (event !== 'call_ended') {
      console.log(`⚡ Quick response for event: ${event}`);
      return res.json({ status: 'received', event: event });
    }
    
    console.log('🎯 Processing call_ended event...');
    
    // Generate reservation ID
    const reservationId = generateReservationId();
    console.log(`🎫 Generated Reservation ID: ${reservationId}`);
    
    // Try multiple data sources for conversation
    let conversationData = null;
    
    if (conversation_history && Array.isArray(conversation_history) && conversation_history.length > 0) {
      console.log(`✅ Using conversation_history with ${conversation_history.length} messages`);
      conversationData = conversation_history;
    } else if (transcript) {
      console.log('✅ Using transcript');
      conversationData = [{ role: 'user', content: transcript }];
    } else {
      console.log('❌ No conversation data found in any field');
      // Create empty conversation to use defaults
      conversationData = [];
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
