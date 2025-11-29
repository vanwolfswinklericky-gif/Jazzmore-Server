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

// Convert day name to actual date
function convertDayToDate(dayName) {
  const today = new Date();
  const dayMap = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    'domenica': 0, 'lunedì': 1, 'martedì': 2, 'mercoledì': 3,
    'giovedì': 4, 'venerdì': 5, 'sabato': 6,
    'today': 'today', 'oggi': 'today', 'tomorrow': 'tomorrow', 'domani': 'tomorrow'
  };
  
  const targetDay = dayMap[dayName.toLowerCase()];
  
  if (targetDay === 'today') {
    return today.toISOString().split('T')[0];
  } else if (targetDay === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  } else if (targetDay !== undefined) {
    const daysUntil = (targetDay - today.getDay() + 7) % 7 || 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate.toISOString().split('T')[0];
  }
  
  // Default to tomorrow if day not recognized
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// BACKTRACK: REGEX LOOKAHEAD + ROLE FIX + DETAILED LOGGING
function extractStructuredData(conversation) {
  console.log('🔍 Looking for structured reservation data...');
  
  // NEW: Log the entire conversation for debugging
  console.log('📜 Full conversation transcript_object:', JSON.stringify(conversation, null, 2));
  
  const defaultReservation = {
    firstName: '',
    lastName: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '22:00',
    guests: 2,
    adults: 2,
    children: 0,
    phone: '',
    specialRequests: 'No special requests',
    newsletter: false
  };

  if (!conversation || !Array.isArray(conversation)) {
    console.log('❌ Conversation is null, empty, or not an array');
    return defaultReservation;
  }

  console.log(`📊 Conversation has ${conversation.length} messages`);

  // Look for the structured data pattern in agent messages
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    console.log(`🔎 Message ${i}: Role=${msg.role}, Content preview: "${msg.content ? msg.content.substring(0, 100) : 'NO CONTENT'}"`);
    
    if (msg.role === 'agent' && msg.content && msg.content.includes('RESERVATION_DATA:')) {  // FIXED: 'assistant' → 'agent'
      console.log('✅ Found structured reservation data!');
      console.log('📝 Full agent message:', msg.content);
      
      const content = msg.content;
      
      // Extract everything after RESERVATION_DATA:
      const dataMatch = content.match(/RESERVATION_DATA:\s*(.*)/i);
      if (!dataMatch) {
        console.log('❌ Could not extract data section');
        return defaultReservation;
      }
      
      const dataSection = dataMatch[1];
      console.log('📋 Data section found:', dataSection);

      // FIXED: Use lookahead patterns to capture until next field
      const fieldPatterns = {
        firstName: /First Name:\s*([^]+?)(?=\s*Last Name:|$)/i,
        lastName: /Last Name:\s*([^]+?)(?=\s*Phone:|$)/i,
        phone: /Phone:\s*([^]+?)(?=\s*Guests:|$)/i,
        guests: /Guests:\s*([^]+?)(?=\s*Adults:|$)/i,
        adults: /Adults:\s*([^]+?)(?=\s*Children:|$)/i,
        children: /Children:\s*([^]+?)(?=\s*Date:|$)/i,
        date: /Date:\s*([^]+?)(?=\s*Time:|$)/i,
        time: /Time:\s*([^]+?)(?=\s*Special Requests:|$)/i,
        specialRequests: /Special Requests:\s*([^]+?)(?=\s*Newsletter:|$)/i,
        newsletter: /Newsletter:\s*([^]+?)$/i
      };
      
      const reservation = { ...defaultReservation };
      
      Object.entries(fieldPatterns).forEach(([field, pattern]) => {
        const match = dataSection.match(pattern);
        if (match && match[1]) {
          const value = match[1].trim();
          console.log(`✅ ${field}: "${value}"`);
          
          switch (field) {
            case 'firstName':
              reservation.firstName = value;
              break;
            case 'lastName':
              reservation.lastName = value;
              break;
            case 'phone':
              reservation.phone = '+39' + value.replace(/\D/g, '');
              break;
            case 'guests':
              reservation.guests = parseInt(value) || 2;
              break;
            case 'adults':
              reservation.adults = parseInt(value) || reservation.guests;
              break;
            case 'children':
              reservation.children = parseInt(value) || 0;
              break;
            case 'date':
              reservation.date = convertDayToDate(value);
              break;
            case 'time':
              reservation.time = value;
              break;
            case 'specialRequests':
              reservation.specialRequests = value === 'None' ? 'No special requests' : value;
              break;
            case 'newsletter':
              reservation.newsletter = value.toLowerCase() === 'yes';
              break;
          }
        } else {
          console.log(`❌ ${field}: NOT FOUND`);
        }
      });
      
      console.log('✅ Successfully parsed structured data:', reservation);
      return reservation;
    }
  }
  
  console.log('❌ No structured data found in conversation');
  // Debug: Log all agent messages to see what we're working with
  conversation.forEach((msg, index) => {
    if (msg.role === 'agent') {
      console.log(`Agent message ${index}:`, msg.content.substring(0, 200) + '...');
    }
  });
  
  return defaultReservation;
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
    
    // Use simple structured data extraction
    const reservationData = extractStructuredData(conversationData);
    
    const { firstName, lastName, date, time, guests, adults, children, phone, specialRequests, newsletter } = reservationData;
    
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
          "Kids Count": parseInt(children) || 0,
          "Special Requests": specialRequests || '',
          "Reservation Status": "Pending",
          "Reservation Type": "Dinner + Show",
          "Newsletter Opt-In": newsletter || false
        }
      }
    ]);
    
    console.log('🎉 RESERVATION SAVED!');
    console.log('Reservation ID:', reservationId);
    console.log('Name:', `${firstName} ${lastName}`.trim());
    console.log('Date/Time:', date, time);
    console.log('Guests:', guests, `(${adults} adults + ${children} children)`);
    console.log('Phone:', phone || 'Not provided');
    console.log('Special Requests:', specialRequests);
    console.log('Newsletter:', newsletter);
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


