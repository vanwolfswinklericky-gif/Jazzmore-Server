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

// Extract reservation from Retell's conversation format
function extractReservationFromConversation(conversation) {
  console.log('🔍 Extracting from Retell conversation data...');
  
  // Default reservation
  let reservation = {
    name: 'Phone Caller',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
    time: '19:30',
    guests: 2,
    phone: '',
    specialRequests: 'Reservation from phone call'
  };
  
  if (!conversation || !Array.isArray(conversation)) {
    console.log('No conversation data, using defaults');
    return reservation;
  }
  
  // Extract all text content from the conversation
  let fullText = '';
  for (const message of conversation) {
    if (message.content) {
      fullText += message.content + ' ';
      console.log(`💬 ${message.role}: ${message.content}`);
    }
  }
  
  console.log('📝 Full conversation text:', fullText);
  
  const textLower = fullText.toLowerCase();
  
  // Extract date
  if (textLower.includes('tomorrow')) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    reservation.date = tomorrow.toISOString().split('T')[0];
    console.log('📅 Found date: tomorrow ->', reservation.date);
  } else if (textLower.includes('today')) {
    reservation.date = new Date().toISOString().split('T')[0];
    console.log('📅 Found date: today');
  }
  
  // Extract time
  if (textLower.includes('twelve') || textLower.includes('12') || textLower.includes('noon')) {
    reservation.time = '12:00';
    console.log('⏰ Found time: 12:00 PM');
  } else if (textLower.includes('seven') || textLower.includes('7')) {
    reservation.time = '19:00';
    console.log('⏰ Found time: 7:00 PM');
  } else if (textLower.includes('eight') || textLower.includes('8')) {
    reservation.time = '20:00';
    console.log('⏰ Found time: 8:00 PM');
  } else if (textLower.includes('nine') || textLower.includes('9')) {
    reservation.time = '21:00';
    console.log('⏰ Found time: 9:00 PM');
  }
  
  // Extract guests
  const guestMatch = textLower.match(/(\d+)\s*(?:people|guests|persons|person)/);
  if (guestMatch) {
    reservation.guests = parseInt(guestMatch[1]);
    console.log('👥 Found guests:', reservation.guests);
  }
  
  // Extract name (simple pattern)
  const nameMatch = textLower.match(/(?:my name is|i'm|i am|it's)\s+([a-z]+\s+[a-z]+)/i);
  if (nameMatch) {
    reservation.name = nameMatch[1];
    console.log('👤 Found name:', reservation.name);
  }
  
  console.log('🎯 Final extracted data:', reservation);
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

// POST new reservation - OPTIMIZED FOR RETELL
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    console.log('Call ID:', req.body.call_id);
    
    // Log conversation structure without overwhelming details
    if (req.body.conversation_history && Array.isArray(req.body.conversation_history)) {
      console.log(`💬 Conversation has ${req.body.conversation_history.length} messages`);
    }
    
    const { event, conversation_history } = req.body;
    
    // Handle all events gracefully
    if (event !== 'call_ended') {
      console.log(`⚡ Handling ${event} event`);
      return res.json({ 
        status: 'success', 
        event: event,
        message: 'Webhook received successfully'
      });
    }
    
    console.log('🎯 Processing call_ended event...');
    
    // Extract reservation data from Retell's format
    const reservationData = extractReservationFromConversation(conversation_history);
    
    const { name, date, time, guests, phone, specialRequests } = reservationData;
    
    // Generate reservation ID
    const reservationId = generateReservationId();
    
    // Format time for Airtable
    const arrivalTimeISO = formatTimeForAirtable(time, date);
    
    // Save to Airtable
    const nameParts = name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';
    
    console.log('💾 Saving to Airtable...');
    const record = await base('Reservations').create([
      {
        "fields": {
          "Reservation ID": reservationId,
          "First Name": firstName,
          "Last Name": lastName,
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
    console.log('Airtable ID:', record[0].id);
    
    // Return success response to Retell
    res.json({
      response: `Perfect! I've reserved ${guests} people for ${date} at ${time}. Your confirmation is ${reservationId}.`
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    // Always return 200 to Retell
    res.json({
      response: "Thank you for your call! We've received your reservation request."
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
  console.log(`📍 Ready for Retell webhooks at /api/reservations`);
});
