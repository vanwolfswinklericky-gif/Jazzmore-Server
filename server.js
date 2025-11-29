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

// ENGLISH - EXTRACT FROM AGENT CONFIRMATIONS
function extractFromAgentConfirmations(conversation) {
  console.log('🎯 Extracting from AGENT confirmations...');
  
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

  if (!conversation || !Array.isArray(conversation)) {
    return reservation;
  }

  // Look for agent confirmation patterns
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    
    if (msg.role === 'assistant' && msg.content) {
      const content = msg.content;
      
      // NAME CONFIRMATION: "So I have Tony Mazarazzi"
      const nameMatch = content.match(/so i have\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i) || 
                       content.match(/i have\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i) ||
                       content.match(/reservation for\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
      
      if (nameMatch && nameMatch[1] && nameMatch[2]) {
        reservation.firstName = nameMatch[1];
        reservation.lastName = nameMatch[2];
        console.log(`✅ Name from agent confirmation: ${reservation.firstName} ${reservation.lastName}`);
      }
      
      // GUEST COUNT CONFIRMATION: "for 2 people", "for 2 guests"
      const guestMatch = content.match(/for\s+(\d+)\s+(?:people|guests)/i) ||
                        content.match(/reservation for\s+(\d+)/i) ||
                        content.match(/(\d+)\s+(?:people|guests)/i);
      
      if (guestMatch && guestMatch[1]) {
        reservation.guests = parseInt(guestMatch[1]);
        reservation.adults = reservation.guests;
        console.log(`✅ Guests from agent confirmation: ${reservation.guests}`);
      }
      
      // DATE/TIME CONFIRMATION: "on Thursday at 9 PM", "for Thursday at 9 PM"
      const dateTimeMatch = content.match(/(?:on|for)\s+(\w+)\s+(?:at|for)\s+(\d+)(?::(\d+))?\s*(AM|PM)?/i) ||
                           content.match(/(\w+)\s+at\s+(\d+)(?::(\d+))?\s*(AM|PM)?/i);
      
      if (dateTimeMatch) {
        // Extract and format time
        let hours = parseInt(dateTimeMatch[2]);
        const minutes = dateTimeMatch[3] || '00';
        const period = dateTimeMatch[4] ? dateTimeMatch[4].toUpperCase() : 'PM';
        
        // Convert to 24-hour format
        if (period === 'PM' && hours < 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        reservation.time = `${hours.toString().padStart(2, '0')}:${minutes}`;
        console.log(`✅ Time from agent confirmation: ${reservation.time}`);
        
        // Handle date
        const dayMatch = dateTimeMatch[1].toLowerCase();
        const today = new Date();
        
        if (dayMatch.includes('today')) {
          reservation.date = today.toISOString().split('T')[0];
        } else if (dayMatch.includes('tomorrow')) {
          const tomorrow = new Date(today);
          tomorrow.setDate(today.getDate() + 1);
          reservation.date = tomorrow.toISOString().split('T')[0];
        } else if (dayMatch.includes('thurs')) {
          const daysUntilThursday = (4 - today.getDay() + 7) % 7 || 7;
          const nextThursday = new Date(today);
          nextThursday.setDate(today.getDate() + daysUntilThursday);
          reservation.date = nextThursday.toISOString().split('T')[0];
        } else if (dayMatch.includes('fri')) {
          const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
          const nextFriday = new Date(today);
          nextFriday.setDate(today.getDate() + daysUntilFriday);
          reservation.date = nextFriday.toISOString().split('T')[0];
        } else if (dayMatch.includes('sat')) {
          const daysUntilSaturday = (6 - today.getDay() + 7) % 7 || 7;
          const nextSaturday = new Date(today);
          nextSaturday.setDate(today.getDate() + daysUntilSaturday);
          reservation.date = nextSaturday.toISOString().split('T')[0];
        } else if (dayMatch.includes('sun')) {
          const daysUntilSunday = (7 - today.getDay() + 7) % 7 || 7;
          const nextSunday = new Date(today);
          nextSunday.setDate(today.getDate() + daysUntilSunday);
          reservation.date = nextSunday.toISOString().split('T')[0];
        } else if (dayMatch.includes('mon')) {
          const daysUntilMonday = (1 - today.getDay() + 7) % 7 || 7;
          const nextMonday = new Date(today);
          nextMonday.setDate(today.getDate() + daysUntilMonday);
          reservation.date = nextMonday.toISOString().split('T')[0];
        } else if (dayMatch.includes('tues')) {
          const daysUntilTuesday = (2 - today.getDay() + 7) % 7 || 7;
          const nextTuesday = new Date(today);
          nextTuesday.setDate(today.getDate() + daysUntilTuesday);
          reservation.date = nextTuesday.toISOString().split('T')[0];
        } else if (dayMatch.includes('wed')) {
          const daysUntilWednesday = (3 - today.getDay() + 7) % 7 || 7;
          const nextWednesday = new Date(today);
          nextWednesday.setDate(today.getDate() + daysUntilWednesday);
          reservation.date = nextWednesday.toISOString().split('T')[0];
        }
        console.log(`✅ Date from agent confirmation: ${reservation.date}`);
      }
      
      // PHONE CONFIRMATION: "phone number is", "contact number is"
      const phoneMatch = content.match(/phone number is\s+([+\d\s\-\(\)]+)/i) ||
                        content.match(/contact number is\s+([+\d\s\-\(\)]+)/i);
      
      if (phoneMatch && phoneMatch[1]) {
        // Clean the phone number
        const cleanPhone = phoneMatch[1].replace(/\D/g, '');
        if (cleanPhone.length >= 10) {
          reservation.phone = '+39' + cleanPhone.slice(-10);
          console.log(`✅ Phone from agent confirmation: ${reservation.phone}`);
        }
      }
      
      // SPECIAL REQUESTS
      if (content.includes('dinner only') || content.includes('only dinner')) {
        reservation.specialRequests = 'Dinner only (no show)';
        console.log('✅ Special request from agent: Dinner only');
      }
    }
  }

  return reservation;
}

// ITALIAN - EXTRACT FROM AGENT CONFIRMATIONS
function extractFromAgentConfirmationsItalian(conversation) {
  console.log('🎯 Estraendo dalle conferme dell AGENTE...');
  
  let reservation = {
    firstName: '',
    lastName: '',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    time: '22:00',
    guests: 2,
    adults: 2,
    children: 0,
    phone: '',
    specialRequests: 'Nessuna richiesta speciale'
  };

  if (!conversation || !Array.isArray(conversation)) {
    return reservation;
  }

  // Cerca pattern di conferma dell'agente
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    
    if (msg.role === 'assistant' && msg.content) {
      const content = msg.content;
      
      // CONFERMA NOME: "Quindi ho Tony Mazarazzi"
      const nameMatch = content.match(/quindi ho\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i) || 
                       content.match(/ho\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i) ||
                       content.match(/prenotazione per\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
      
      if (nameMatch && nameMatch[1] && nameMatch[2]) {
        reservation.firstName = nameMatch[1];
        reservation.lastName = nameMatch[2];
        console.log(`✅ Nome dalla conferma agente: ${reservation.firstName} ${reservation.lastName}`);
      }
      
      // CONFERMA NUMERO OSPITI: "per 2 persone", "per 2 ospiti"
      const guestMatch = content.match(/per\s+(\d+)\s+(?:persone|ospiti)/i) ||
                        content.match(/prenotazione per\s+(\d+)/i) ||
                        content.match(/(\d+)\s+(?:persone|ospiti)/i);
      
      if (guestMatch && guestMatch[1]) {
        reservation.guests = parseInt(guestMatch[1]);
        reservation.adults = reservation.guests;
        console.log(`✅ Ospiti dalla conferma agente: ${reservation.guests}`);
      }
      
      // CONFERMA DATA/ORA: "giovedì alle 21", "per giovedì alle 21"
      const dateTimeMatch = content.match(/(?:per|il)\s+(\w+)\s+(?:alle|alle ore)\s+(\d+)(?::(\d+))?/i) ||
                           content.match(/(\w+)\s+alle\s+(\d+)(?::(\d+))?/i);
      
      if (dateTimeMatch) {
        let hours = parseInt(dateTimeMatch[2]);
        const minutes = dateTimeMatch[3] || '00';
        
        // Assume evening hours if not specified
        if (hours < 8) hours += 12;
        
        reservation.time = `${hours.toString().padStart(2, '0')}:${minutes}`;
        console.log(`✅ Orario dalla conferma agente: ${reservation.time}`);
        
        // Gestione data
        const dayMatch = dateTimeMatch[1].toLowerCase();
        const today = new Date();
        
        if (dayMatch.includes('oggi')) {
          reservation.date = today.toISOString().split('T')[0];
        } else if (dayMatch.includes('domani')) {
          const tomorrow = new Date(today);
          tomorrow.setDate(today.getDate() + 1);
          reservation.date = tomorrow.toISOString().split('T')[0];
        } else if (dayMatch.includes('giov')) {
          const daysUntilThursday = (4 - today.getDay() + 7) % 7 || 7;
          const nextThursday = new Date(today);
          nextThursday.setDate(today.getDate() + daysUntilThursday);
          reservation.date = nextThursday.toISOString().split('T')[0];
        } else if (dayMatch.includes('ven')) {
          const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
          const nextFriday = new Date(today);
          nextFriday.setDate(today.getDate() + daysUntilFriday);
          reservation.date = nextFriday.toISOString().split('T')[0];
        } else if (dayMatch.includes('sab')) {
          const daysUntilSaturday = (6 - today.getDay() + 7) % 7 || 7;
          const nextSaturday = new Date(today);
          nextSaturday.setDate(today.getDate() + daysUntilSaturday);
          reservation.date = nextSaturday.toISOString().split('T')[0];
        } else if (dayMatch.includes('dom')) {
          const daysUntilSunday = (7 - today.getDay() + 7) % 7 || 7;
          const nextSunday = new Date(today);
          nextSunday.setDate(today.getDate() + daysUntilSunday);
          reservation.date = nextSunday.toISOString().split('T')[0];
        } else if (dayMatch.includes('lun')) {
          const daysUntilMonday = (1 - today.getDay() + 7) % 7 || 7;
          const nextMonday = new Date(today);
          nextMonday.setDate(today.getDate() + daysUntilMonday);
          reservation.date = nextMonday.toISOString().split('T')[0];
        } else if (dayMatch.includes('mar')) {
          const daysUntilTuesday = (2 - today.getDay() + 7) % 7 || 7;
          const nextTuesday = new Date(today);
          nextTuesday.setDate(today.getDate() + daysUntilTuesday);
          reservation.date = nextTuesday.toISOString().split('T')[0];
        } else if (dayMatch.includes('mer')) {
          const daysUntilWednesday = (3 - today.getDay() + 7) % 7 || 7;
          const nextWednesday = new Date(today);
          nextWednesday.setDate(today.getDate() + daysUntilWednesday);
          reservation.date = nextWednesday.toISOString().split('T')[0];
        }
        console.log(`✅ Data dalla conferma agente: ${reservation.date}`);
      }
      
      // CONFERMA TELEFONO: "numero di telefono è", "telefono è"
      const phoneMatch = content.match(/numero di telefono è\s+([+\d\s\-\(\)]+)/i) ||
                        content.match(/telefono è\s+([+\d\s\-\(\)]+)/i);
      
      if (phoneMatch && phoneMatch[1]) {
        const cleanPhone = phoneMatch[1].replace(/\D/g, '');
        if (cleanPhone.length >= 10) {
          reservation.phone = '+39' + cleanPhone.slice(-10);
          console.log(`✅ Telefono dalla conferma agente: ${reservation.phone}`);
        }
      }
      
      // RICHIESTE SPECIALI
      if (content.includes('solo cena') || content.includes('cena solamente')) {
        reservation.specialRequests = 'Solo cena (no spettacolo)';
        console.log('✅ Richiesta speciale dall agente: Solo cena');
      }
    }
  }

  return reservation;
}

// MAIN EXTRACTION FUNCTION - FOCUS ON AGENT CONFIRMATIONS
function extractReservationFromConversation(conversation) {
  console.log('🔍 Starting EXTRACTION from AGENT confirmations...');
  
  let defaultReservation = {
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
    return defaultReservation;
  }
  
  console.log(`📞 Processing ${conversation.length} conversation messages`);
  
  // Log the conversation for debugging
  conversation.forEach((msg, index) => {
    console.log(`${index}. ${msg.role.toUpperCase()}: ${msg.content}`);
  });
  
  // Detect language from conversation content
  const allText = conversation.map(msg => msg.content).join(' ').toLowerCase();
  const isItalian = allText.includes('grazie') || allText.includes('perfetto') || 
                   allText.includes('prego') || allText.includes('ciao') ||
                   allText.includes('buongiorno') || allText.includes('buonasera');
  
  console.log(`🌍 Language detected: ${isItalian ? 'Italian' : 'English'}`);
  
  // Use agent confirmation extraction
  let reservation;
  if (isItalian) {
    reservation = extractFromAgentConfirmationsItalian(conversation);
    // Update default for Italian
    defaultReservation.specialRequests = 'Nessuna richiesta speciale';
  } else {
    reservation = extractFromAgentConfirmations(conversation);
  }
  
  // Merge with defaults to ensure all fields are populated
  const finalReservation = { ...defaultReservation, ...reservation };
  
  console.log('✅ FINAL Extraction result from agent confirmations:', finalReservation);
  return finalReservation;
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
          "Kids Count": parseInt(children) || 0,
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
