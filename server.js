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
    // Combine date and time into a full ISO string
    const [hours, minutes] = timeString.split(':');
    const date = new Date(dateString);
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    
    return date.toISOString();
  } catch (error) {
    console.log('Error formatting time, using default:', error);
    // Return a default time if parsing fails
    const defaultDate = new Date(dateString);
    defaultDate.setHours(19, 30, 0, 0); // 7:30 PM
    return defaultDate.toISOString();
  }
}

// Fixed reservation extraction for real Retell data
function extractReservationFromConversation(conversation) {
  if (!conversation || !Array.isArray(conversation)) return null;
  
  console.log('Processing REAL Retell conversation:', conversation.length, 'messages');
  
  let reservation = {
    name: 'Guest', // Default name
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
    time: '19:30',
    guests: 2,
    phone: '',
    specialRequests: 'Reservation from phone call'
  };
  
  // Extract the actual conversation content (ignore words arrays)
  const conversationText = conversation.map(msg => msg.content).join(' ');
  console.log('Full conversation text:', conversationText);
  
  // Look for key information in the conversation
  for (const message of conversation) {
    const content = message.content.toLowerCase();
    const role = message.role;
    
    console.log(`Processing ${role} message:`, content);
    
    // Extract date - look for "tomorrow" or specific dates
    if (content.includes('tomorrow')) {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      reservation.date = tomorrow.toISOString().split('T')[0];
      console.log('Found date (tomorrow):', reservation.date);
    } else if (content.includes('today')) {
      reservation.date = new Date().toISOString().split('T')[0];
      console.log('Found date (today):', reservation.date);
    }
    
    // Extract time - look for time patterns
    if (content.includes('twelve pm') || content.includes('12 pm') || content.includes('noon') || content.includes('midday')) {
      reservation.time = '12:00';
      console.log('Found time: 12:00 PM');
    } else if (content.includes('seven pm') || content.includes('7 pm') || content.includes('19:00')) {
      reservation.time = '19:00';
      console.log('Found time: 7:00 PM');
    } else if (content.includes('eight pm') || content.includes('8 pm') || content.includes('20:00')) {
      reservation.time = '20:00';
      console.log('Found time: 8:00 PM');
    } else if (content.includes('nine pm') || content.includes('9 pm') || content.includes('21:00')) {
      reservation.time = '21:00';
      console.log('Found time: 9:00 PM');
    } else if (content.includes('six pm') || content.includes('6 pm') || content.includes('18:00')) {
      reservation.time = '18:00';
      console.log('Found time: 6:00 PM');
    }
    
    // Extract guests - look for number of people
    const guestMatch = content.match(/(\d+)\s*(?:people|guests|persons|person)/i);
    if (guestMatch) {
      reservation.guests = parseInt(guestMatch[1]);
      console.log('Found guests:', reservation.guests);
    }
    
    // Extract name - look for name patterns (only from user messages)
    if (role === 'user') {
      const nameMatch = content.match(/(?:my name is|i'm|I am|it's|this is)\s+([a-zA-Z]+\s+[a-zA-Z]+)/i);
      if (nameMatch) {
        reservation.name = nameMatch[1].trim();
        console.log('Found name:', reservation.name);
      }
    }
    
    // Extract phone
    const phoneMatch = content.match(/(\d{3}[-.]?\d{3}[-.]?\d{4})/);
    if (phoneMatch) {
      reservation.phone = phoneMatch[1];
      console.log('Found phone:', reservation.phone);
    }
    
    // Extract special requests
    if (content.includes('window') || content.includes('birthday') || content.includes('anniversary') || 
        content.includes('allergy') || content.includes('special') || content.includes('vegetarian')) {
      reservation.specialRequests = "Special request: " + content;
      console.log('Found special request');
    }
  }
  
  console.log('Final extracted reservation:', reservation);
  return reservation;
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

// POST new reservation (Retell AI webhook) - OPTIMIZED FOR REAL DATA
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('=== RETELL WEBHOOK RECEIVED ===');
    console.log('Full Body:', JSON.stringify(req.body, null, 2));
    console.log('=== END WEBHOOK DATA ===');
    
    const { call_id, event, conversation_history, transcript } = req.body;
    
    console.log('Extracted fields:');
    console.log('- call_id:', call_id);
    console.log('- event:', event);
    console.log('- conversation_history:', conversation_history ? `Array(${conversation_history.length})` : 'undefined');
    console.log('- transcript:', transcript);
    
    // Process both call_ended and call_analyzed events
    if (event !== 'call_ended' && event !== 'call_analyzed') {
      console.log('Ignoring event:', event);
      return res.json({ status: 'ignored', reason: 'unhandled_event' });
    }
    
    // Try different conversation data locations
    let conversationData = conversation_history;
    
    // If no conversation_history, check for transcript or other fields
    if (!conversationData && transcript) {
      console.log('Using transcript instead of conversation_history');
      conversationData = [{ role: 'user', content: transcript }];
    }
    
    // If still no data, check for any array in the body
    if (!conversationData) {
      console.log('Looking for conversation data in other fields...');
      for (const [key, value] of Object.entries(req.body)) {
        if (Array.isArray(value) && value.length > 0 && value[0].content) {
          console.log('Found conversation data in field:', key);
          conversationData = value;
          break;
        }
      }
    }
    
    let reservationData;
    
    if (conversationData) {
      // Extract reservation details from conversation
      reservationData = extractReservationFromConversation(conversationData);
    }
    
    if (!reservationData) {
      console.log('No reservation data extracted, creating default reservation');
      // Create a default reservation for testing
      reservationData = {
        name: 'Phone Caller',
        date: new Date().toISOString().split('T')[0],
        time: '19:30',
        guests: 2,
        phone: '',
        specialRequests: 'Reservation from phone call - details to be confirmed'
      };
    }
    
    const { name, date, time, guests, phone, specialRequests } = reservationData;
    
    // Generate reservation ID
    const reservationId = generateReservationId();
    
    // Format time for Airtable (combine date + time)
    const arrivalTimeISO = formatTimeForAirtable(time, date);
    console.log('Formatted arrival time for Airtable:', arrivalTimeISO);
    
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
    
    console.log('🎉 RESERVATION SUCCESSFULLY SAVED TO AIRTABLE!');
    console.log('Reservation ID:', reservationId);
    console.log('Airtable Record ID:', record[0].id);
    console.log('Details:', { name, date, time, guests });
    
    res.json({
      response: `Perfect! I've reserved ${guests} people for ${date} at ${time}. Your confirmation is ${reservationId}.`
    });
    
  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    res.status(500).json({ 
      error: 'Failed to process reservation',
      details: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
});
