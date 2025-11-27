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

// Improved reservation extraction from conversation
function extractReservationFromConversation(conversation) {
  if (!conversation || !Array.isArray(conversation)) return null;
  
  console.log('Processing conversation:', JSON.stringify(conversation, null, 2));
  
  let reservation = {
    name: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
    time: '19:30',
    guests: 2,
    phone: '',
    email: '',
    specialRequests: ''
  };
  
  // Look for reservation patterns in the entire conversation
  const fullText = conversation.map(msg => msg.content).join(' ').toLowerCase();
  
  console.log('Full conversation text:', fullText);
  
  // Extract guests
  const guestMatch = fullText.match(/(\d+)\s*(?:people|guests|persons|pax|for)/i);
  if (guestMatch) {
    reservation.guests = parseInt(guestMatch[1]);
    console.log('Found guests:', reservation.guests);
  }
  
  // Extract time - handle various formats
  const timeMatch = fullText.match(/(\d{1,2})(?::(\d{2}))?\s*(pm|am)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3] ? timeMatch[3].toLowerCase() : '';
    
    // Convert to 24-hour format
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    if (hours === 24) hours = 0; // Handle midnight
    
    reservation.time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    console.log('Found time:', reservation.time);
  }
  
  // Extract name - multiple patterns
  const namePatterns = [
    /(?:my name is|i'm|I am|name is|for)\s+([a-zA-Z]+\s+[a-zA-Z]+)/i,
    /(?:book(?:ing)?|reserv(?:ation)?)\s+(?:for)?\s+([a-zA-Z]+\s+[a-zA-Z]+)/i,
    /(?:under|for)\s+([a-zA-Z]+\s+[a-zA-Z]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = fullText.match(pattern);
    if (nameMatch && nameMatch[1]) {
      reservation.name = nameMatch[1].trim();
      console.log('Found name:', reservation.name);
      break;
    }
  }
  
  // If no name found, use a default
  if (!reservation.name) {
    reservation.name = "Test Customer";
    console.log('Using default name');
  }
  
  // Extract phone
  const phoneMatch = fullText.match(/(\d{3}[-.]?\d{3}[-.]?\d{4})/);
  if (phoneMatch) {
    reservation.phone = phoneMatch[1];
    console.log('Found phone:', reservation.phone);
  }
  
  // Extract special requests
  if (fullText.includes('window') || fullText.includes('birthday') || fullText.includes('allergy') || fullText.includes('special')) {
    reservation.specialRequests = "Special request mentioned in conversation";
    console.log('Found special request');
  }
  
  console.log('Final extracted reservation:', reservation);
  
  // Return if we have at least name and guests
  if (reservation.name && reservation.guests) {
    return reservation;
  }
  
  console.log('Insufficient data for reservation');
  return null;
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

// POST new reservation (Retell AI webhook) - WITH DEBUG LOGGING
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('=== FULL RETELL WEBHOOK REQUEST ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Full Body:', JSON.stringify(req.body, null, 2));
    console.log('=== END WEBHOOK REQUEST ===');
    
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
      // Convert transcript to conversation format if needed
      conversationData = [{ role: 'user', content: transcript }];
    }
    
    // If still no data, check for any array in the body
    if (!conversationData) {
      console.log('Looking for conversation data in other fields...');
      for (const [key, value] of Object.entries(req.body)) {
        if (Array.isArray(value) && value.length > 0 && value[0].role) {
          console.log('Found conversation data in field:', key);
          conversationData = value;
          break;
        }
      }
    }
    
    if (!conversationData) {
      console.log('No conversation data found in any field');
      console.log('All body keys:', Object.keys(req.body));
      return res.json({ 
        status: 'no_conversation_data',
        message: 'No conversation data found in webhook'
      });
    }
    
    // Extract reservation details from conversation
    const reservationData = extractReservationFromConversation(conversationData);
    
    if (!reservationData) {
      console.log('No reservation data extracted from conversation');
      return res.json({ 
        status: 'no_reservation',
        message: 'No reservation data found in conversation'
      });
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
