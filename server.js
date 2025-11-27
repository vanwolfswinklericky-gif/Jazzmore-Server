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

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: '🎵 Jazzamore Server is running!',
    status: 'Ready for reservations',
    endpoints: {
      health: '/health',
      createReservation: 'POST /api/reservations',
      getReservations: 'GET /api/reservations'
    }
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
    if (process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID) {
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
    }

    res.json({
      message: 'Connect Airtable to see real reservations'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new reservation (Retell AI webhook)
app.post('/api/reservations', async (req, res) => {
  try {
    const { call_id, event, conversation_history } = req.body;
    
    console.log('Retell webhook received:', { call_id, event });
    
    // Only process when call ends
    if (event !== 'call_ended') {
      return res.json({ status: 'ignored', reason: 'not_call_ended' });
    }
    
    // Extract reservation details from conversation
    const reservationData = extractReservationFromConversation(conversation_history);
    
    if (!reservationData) {
      return res.json({ 
        status: 'no_reservation',
        message: 'No reservation data found in conversation'
      });
    }
    
    const { name, date, time, guests, phone, email, specialRequests } = reservationData;
    
    // Generate reservation ID
    const reservationId = generateReservationId();
    
    // Save to Airtable
    const nameParts = name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || '';
    
    const record = await base('Reservations').create([
      {
        "fields": {
          "Reservation ID": reservationId,
          "First Name": firstName,
          "Last Name": lastName,
          "Email": email || '',
          "Phone Number": phone || '',
          "Reservation Date": date,
          "Arrival Time": time,
          "Total People": parseInt(guests),
          "Special Requests": specialRequests || '',
          "Reservation Status": "Pending",
          "Reservation Type": "Dinner + Show",
          "Dinner Count": parseInt(guests),
          "Show-Only Count": 0,
          "Kids Count": 0,
          "Newsletter Opt-In": false,
          "Call ID": call_id,
          "Created": new Date().toISOString()
        }
      }
    ]);
    
    console.log('Reservation saved:', reservationId, record[0].id);
    
    res.json({
      response: `Perfect! I've reserved ${guests} people for ${date} at ${time}. Your confirmation is ${reservationId}.`
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process reservation',
      details: error.message 
    });
  }
});

// Extract reservation from conversation history
function extractReservationFromConversation(conversation) {
  if (!conversation || !Array.isArray(conversation)) return null;
  
  // Simple extraction - you'll want to make this more robust
  const lastMessages = conversation.slice(-10);
  
  let reservation = {};
  
  lastMessages.forEach(msg => {
    const content = msg.content.toLowerCase();
    
    // Extract name
    if (content.includes('name is') || content.includes('my name is')) {
      const nameMatch = content.match(/(?:my name is|i'm|I am) ([a-zA-Z ]+)/i);
      if (nameMatch) reservation.name = nameMatch[1].trim();
    }
    
    // Extract date
    if (content.includes('date') || content.includes('today') || content.includes('tomorrow')) {
      reservation.date = '2024-01-25'; // Placeholder - improve this
    }
    
    // Extract time
    if (content.includes('time') || content.match(/\d+:\d+/)) {
      const timeMatch = content.match(/(\d+:\d+)/);
      if (timeMatch) reservation.time = timeMatch[1];
    }
    
    // Extract guests
    if (content.includes('people') || content.includes('guests')) {
      const guestMatch = content.match(/(\d+) (?:people|guests)/i);
      if (guestMatch) reservation.guests = guestMatch[1];
    }

    // Extract phone
    if (content.includes('phone') || content.match(/\d{10,}/)) {
      const phoneMatch = content.match(/(\d{10,})/);
      if (phoneMatch) reservation.phone = phoneMatch[1];
    }

    // Extract email
    if (content.includes('@')) {
      const emailMatch = content.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/i);
      if (emailMatch) reservation.email = emailMatch[1];
    }
  });
  
  // Only return if we have required fields
  if (reservation.name && reservation.date && reservation.time && reservation.guests) {
    return reservation;
  }
  
  return null;
}

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
});
