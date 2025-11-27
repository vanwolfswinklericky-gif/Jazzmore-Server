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

// Enhanced extraction for real conversation data
function extractReservationFromConversation(conversation) {
  console.log('🔍 Advanced extraction from Retell conversation...');
  
  let reservation = {
    firstName: '',
    lastName: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '19:30',
    guests: 2,
    phone: '',
    specialRequests: ''
  };
  
  if (!conversation || !Array.isArray(conversation)) {
    console.log('No conversation data');
    return reservation;
  }
  
  // Build complete conversation text
  let fullText = '';
  for (const message of conversation) {
    if (message.content && message.role === 'user') {
      fullText += message.content + ' ';
      console.log(`🗣️ USER: ${message.content}`);
    }
  }
  
  const textLower = fullText.toLowerCase();
  console.log('📝 User conversation:', fullText);
  
  // EXTRACT NAME - More sophisticated patterns
  const namePatterns = [
    /my name is (\w+) (\w+)/i,
    /i'm (\w+) (\w+)/i,
    /i am (\w+) (\w+)/i,
    /this is (\w+) (\w+)/i,
    /it's (\w+) (\w+)/i,
    /for (\w+) (\w+)/i,
    /under (\w+) (\w+)/i,
    /name (\w+) (\w+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = fullText.match(pattern);
    if (match && match[1] && match[2]) {
      reservation.firstName = match[1];
      reservation.lastName = match[2];
      console.log(`👤 Found name: ${reservation.firstName} ${reservation.lastName}`);
      break;
    }
  }
  
  // If no full name found, try single name
  if (!reservation.firstName) {
    const singleNameMatch = fullText.match(/(?:my name is|i'm|i am|this is|it's) (\w+)/i);
    if (singleNameMatch) {
      reservation.firstName = singleNameMatch[1];
      console.log(`👤 Found first name only: ${reservation.firstName}`);
    }
  }
  
  // EXTRACT PHONE NUMBER - Multiple formats
  const phonePatterns = [
    /\b(\d{3}[-.]?\d{3}[-.]?\d{4})\b/,
    /\b(\d{3}\s\d{3}\s\d{4})\b/,
    /\b(\d{10})\b/,
    /phone.*?(\d{3}[-.]?\d{3}[-.]?\d{4})/i,
    /number.*?(\d{3}[-.]?\d{3}[-.]?\d{4})/i
  ];
  
  for (const pattern of phonePatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      reservation.phone = match[1].replace(/[^\d]/g, '');
      console.log(`📞 Found phone: ${reservation.phone}`);
      break;
    }
  }
  
  // EXTRACT DATE
  if (textLower.includes('tomorrow')) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    reservation.date = tomorrow.toISOString().split('T')[0];
    console.log('📅 Date: tomorrow');
  } else if (textLower.includes('today')) {
    reservation.date = new Date().toISOString().split('T')[0];
    console.log('📅 Date: today');
  }
  
  // EXTRACT TIME
  if (textLower.includes('twelve') || textLower.includes('12') || textLower.includes('noon')) {
    reservation.time = '12:00';
    console.log('⏰ Time: 12:00 PM');
  } else if (textLower.includes('seven') || textLower.includes('7')) {
    reservation.time = textLower.includes('am') ? '07:00' : '19:00';
    console.log('⏰ Time: 7:00');
  } else if (textLower.includes('eight') || textLower.includes('8')) {
    reservation.time = textLower.includes('am') ? '08:00' : '20:00';
    console.log('⏰ Time: 8:00');
  } else if (textLower.includes('nine') || textLower.includes('9')) {
    reservation.time = textLower.includes('am') ? '09:00' : '21:00';
    console.log('⏰ Time: 9:00');
  }
  
  // EXTRACT GUESTS
  const guestMatch = textLower.match(/(\d+)\s*(?:people|guests|persons|person|for)/);
  if (guestMatch) {
    reservation.guests = parseInt(guestMatch[1]);
    console.log(`👥 Guests: ${reservation.guests}`);
  }
  
  // EXTRACT SPECIAL REQUESTS
  const requestKeywords = ['window', 'birthday', 'anniversary', 'allergy', 'vegetarian', 'vegan', 'gluten', 'special', 'celebrat'];
  for (const keyword of requestKeywords) {
    if (textLower.includes(keyword)) {
      // Find the sentence containing the keyword
      const sentences = fullText.split(/[.!?]+/);
      for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(keyword)) {
          reservation.specialRequests = sentence.trim();
          console.log(`🎯 Special request: ${reservation.specialRequests}`);
          break;
        }
      }
      break;
    }
  }
  
  // Set defaults if missing
  if (!reservation.firstName) {
    reservation.firstName = 'Caller';
    reservation.lastName = '';
    console.log('👤 Using default name: Caller');
  }
  
  console.log('🎯 EXTRACTION COMPLETE:', {
    name: `${reservation.firstName} ${reservation.lastName}`.trim(),
    date: reservation.date,
    time: reservation.time,
    guests: reservation.guests,
    phone: reservation.phone || 'Not provided',
    specialRequests: reservation.specialRequests || 'None'
  });
  
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

// POST new reservation - WITH ENHANCED EXTRACTION
app.post('/api/reservations', async (req, res) => {
  try {
    console.log('\n📞 RETELL WEBHOOK RECEIVED');
    console.log('Event:', req.body.event);
    
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
    
    // Extract detailed reservation data
    const reservationData = extractReservationFromConversation(conversation_history);
    
    const { firstName, lastName, date, time, guests, phone, specialRequests } = reservationData;
    
    // Generate reservation ID
    const reservationId = generateReservationId();
    
    // Format time for Airtable
    const arrivalTimeISO = formatTimeForAirtable(time, date);
    
    // Save to Airtable with proper names
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
