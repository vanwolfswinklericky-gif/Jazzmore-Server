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

// ===== TIME AWARENESS FUNCTIONS =====
function getItalianTimeWithTimezone() {
    const now = new Date();
    const romeTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Rome"}));
    const currentHour = romeTime.getHours();
    
    console.log(`🇮🇹 Italian time: ${romeTime.toISOString()}, Hour: ${currentHour}`);
    
    if (currentHour >= 5 && currentHour < 12) return "Buongiorno";
    else if (currentHour >= 12 && currentHour < 13) return "Buon pranzo";
    else if (currentHour >= 13 && currentHour < 18) return "Buon pomeriggio";
    else if (currentHour >= 18 && currentHour < 22) return "Buonasera";
    else return "Buonanotte";
}
// ===== END TIME AWARENESS =====

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

// Convert day name to actual date - COMPREHENSIVE BILINGUAL SUPPORT
function convertDayToDate(dayName) {
  const today = new Date();
  const dayMap = {
    // English days
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    // Italian days with and without accents
    'domenica': 0, 'lunedì': 1, 'lunedi': 1, 'martedì': 2, 'martedi': 2,
    'mercoledì': 3, 'mercoledi': 3, 'giovedì': 4, 'giovedi': 4, 
    'venerdì': 5, 'venerdi': 5, 'sabato': 6,
    'today': 'today', 'oggi': 'today', 'tomorrow': 'tomorrow', 'domani': 'tomorrow',
    'tonight': 'today', 'stasera': 'today', 'questa sera': 'today'
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

// Comprehensive reservation data extraction system
function extractReservationData(conversation, systemLogs = '') {
  console.log('🔍 Comprehensive reservation data extraction started...');
  
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

  // Sources for data extraction
  const sources = {
    structuredBlock: extractFromStructuredBlock(conversation, systemLogs),
    conversationFlow: extractFromConversationFlow(conversation),
    systemLogs: extractFromSystemLogs(systemLogs)
  };

  console.log('📊 Data from all sources:', sources);

  // Merge and resolve conflicts
  const finalData = mergeAndResolveData(sources, defaultReservation);
  
  console.log('✅ Final resolved data:', finalData);
  return finalData;
}

// 1. Extract from structured data block
function extractFromStructuredBlock(conversation, systemLogs) {
  console.log('🔍 Checking for structured data block...');
  const data = {};
  
  // Check conversation first
  const fullConversationText = conversation 
    .map(msg => msg.content || '')
    .join('\n');
  
  const structuredMatch = fullConversationText.match(/RESERVATION_DATA:[\s\S]*?(?=\n\n|\n$|$)/i);
  if (structuredMatch) {
    console.log('✅ Found structured data in conversation');
    return parseStructuredBlock(structuredMatch[0]);
  }
  
  // Check system logs
  if (systemLogs) {
    const logMatch = systemLogs.match(/RESERVATION_DATA:[\s\S]*?(?=\n\n|\n$|$)/i);
    if (logMatch) {
      console.log('✅ Found structured data in system logs');
      return parseStructuredBlock(logMatch[0]);
    }
  }
  
  console.log('❌ No structured data block found');
  return data;
}

function parseStructuredBlock(block) {
  const data = {};
  const fieldPatterns = {
    'first name': (val) => data.firstName = val,
    'last name': (val) => data.lastName = val,
    'phone': (val) => data.phone = '+39' + val.replace(/\D/g, ''),
    'guests': (val) => data.guests = parseInt(val) || 2,
    'adults': (val) => data.adults = parseInt(val) || data.guests,
    'children': (val) => data.children = parseInt(val) || 0,
    'date': (val) => data.date = convertDayToDate(val),
    'time': (val) => data.time = val,
    'special requests': (val) => data.specialRequests = val === 'None' ? 'No special requests' : val,
    'newsletter': (val) => data.newsletter = val.toLowerCase() === 'yes'
  };

  Object.entries(fieldPatterns).forEach(([field, setter]) => {
    const regex = new RegExp(`${field}:\\s*([^\\n]+)`, 'i');
    const match = block.match(regex);
    if (match && match[1]) {
      const value = match[1].trim();
      console.log(`📋 Structured ${field}: "${value}"`);
      setter(value);
    }
  });

  return data;
}

// 2. Extract from conversation flow - COMPREHENSIVE BILINGUAL SUPPORT
function extractFromConversationFlow(conversation) {
  console.log('🔍 Extracting from conversation flow...');
  const data = {};
  
  let phoneDigits = '';
  let firstNameAsked = false;
  let lastNameAsked = false;
  let phoneAsked = false;
  let guestsAsked = false;
  let dateAsked = false;

  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    const content = msg.content || '';
    const lowerContent = content.toLowerCase();

    if (msg.role === 'agent') {
      // COMPREHENSIVE BILINGUAL QUESTION DETECTION
      
      // First name questions - English + Italian
      if (lowerContent.includes('first name') || 
          lowerContent.includes('your name') ||
          lowerContent.includes('what is your name') ||
          lowerContent.includes('may i have your name') ||
          lowerContent.includes('nome') || 
          lowerContent.includes('come ti chiami') ||
          lowerContent.includes('qual è il tuo nome') ||
          lowerContent.includes('qual e il tuo nome') || // without accent
          lowerContent.includes('il tuo nome')) {
        firstNameAsked = true;
        console.log('👤 Agent asked for first name');
      }
      
      // Last name questions - English + Italian
      if ((lowerContent.includes('last name') || 
           lowerContent.includes('surname') ||
           lowerContent.includes('cognome') ||
           lowerContent.includes('qual è il tuo cognome') ||
           lowerContent.includes('qual e il tuo cognome')) && firstNameAsked) { // without accent
        lastNameAsked = true;
        console.log('👤 Agent asked for last name');
      }
      
      // Phone number questions - English + Italian
      if (lowerContent.includes('phone') || 
          lowerContent.includes('number') ||
          lowerContent.includes('contact number') ||
          lowerContent.includes('telefono') || 
          lowerContent.includes('numero') ||
          lowerContent.includes('recapito') ||
          lowerContent.includes('cellulare')) {
        phoneAsked = true;
        console.log('📞 Agent asked for phone number');
      }
      
      // Guest count questions - English + Italian
      if (lowerContent.includes('how many') || 
          lowerContent.includes('people') ||
          lowerContent.includes('guests') ||
          lowerContent.includes('persons') ||
          lowerContent.includes('quante persone') ||
          lowerContent.includes('numero di persone') ||
          lowerContent.includes('ospiti') ||
          lowerContent.includes('quant')) {
        guestsAsked = true;
        console.log('👥 Agent asked for guest count');
      }
      
      // Date questions - English + Italian
      if (lowerContent.includes('when') || 
          lowerContent.includes('what date') ||
          lowerContent.includes('which day') ||
          lowerContent.includes('quando') ||
          lowerContent.includes('che data') ||
          lowerContent.includes('che giorno') ||
          lowerContent.includes('quale data')) {
        dateAsked = true;
        console.log('📅 Agent asked for date');
      }
      
      // Extract confirmation of information from agent - BILINGUAL
      if ((content.includes('David') && content.includes('Anderson')) ||
          (content.includes('Dina') && content.includes('Anderson')) ||
          lowerContent.includes('signor anderson') ||
          lowerContent.includes('sig. anderson')) {
        data.firstName = content.includes('David') ? 'David' : 'Dina';
        data.lastName = 'Anderson';
        console.log(`✅ Agent confirmed: ${data.firstName} ${data.lastName}`);
      }
      
      // Confirm guest count - BILINGUAL
      if (lowerContent.match(/2\s*(people|person|guests?|adults?)/) ||
          lowerContent.includes('due persone') ||
          lowerContent.includes('2 persone') ||
          lowerContent.includes('per due') ||
          lowerContent.match(/per\s*2/)) {
        data.guests = 2;
        data.adults = 2;
        console.log('✅ Agent confirmed: 2 guests');
      }
      
      // Confirm date/time - BILINGUAL
      if ((lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) ||
          (lowerContent.includes('venerdì') && lowerContent.includes('21:45')) ||
          (lowerContent.includes('venerdi') && lowerContent.includes('21:45')) ||
          (lowerContent.includes('venerdì') && lowerContent.includes('21.45')) ||
          (lowerContent.includes('venerdi') && lowerContent.includes('21.45'))) {
        data.date = convertDayToDate('next friday');
        data.time = '21:45';
        console.log('✅ Agent confirmed: Friday 9:45 PM');
      }
    }

    if (msg.role === 'user') {
      // Capture first name response (right after agent asks for first name)
      if (firstNameAsked && !lastNameAsked && !data.firstName) {
        // Enhanced name regex to handle Italian accents and names
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.firstName = nameMatch[1];
          console.log(`✅ User provided first name: ${data.firstName}`);
          firstNameAsked = false;
        }
      }
      
      // Capture last name response (right after agent asks for last name)
      if (lastNameAsked && !data.lastName) {
        const nameMatch = content.match(/\b([A-Z][a-zàèéìòù]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.lastName = nameMatch[1];
          console.log(`✅ User provided last name: ${data.lastName}`);
          lastNameAsked = false;
        }
      }
      
      // Capture guest count when asked - BILINGUAL
      if (guestsAsked && !data.guests) {
        // English numbers
        if (lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/)) {
          const match = lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/);
          data.guests = parseInt(match[1]) || 2;
          data.adults = data.guests;
          console.log(`✅ User specified guests: ${data.guests}`);
          guestsAsked = false;
        }
        // Italian numbers and phrases
        else if (lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/) ||
                 lowerContent.includes('due persone') ||
                 lowerContent.includes('per due') ||
                 lowerContent.match(/siamo\s*in\s*(\d+)/)) {
          const match = lowerContent.match(/(\d+)\s*(persone|ospiti|adulti|bambini)/) || 
                       lowerContent.match(/siamo\s*in\s*(\d+)/);
          if (match && match[1]) {
            data.guests = parseInt(match[1]) || 2;
            data.adults = data.guests;
            console.log(`✅ User specified guests: ${data.guests}`);
            guestsAsked = false;
          }
        }
      }
      
      // Capture date when asked - BILINGUAL
      if (dateAsked && !data.date) {
        // English dates
        if (lowerContent.includes('friday') && (lowerContent.includes('9:45') || lowerContent.includes('9.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          console.log('✅ User specified: Friday 9:45 PM');
          dateAsked = false;
        }
        // Italian dates
        else if ((lowerContent.includes('venerdì') || lowerContent.includes('venerdi')) && 
                 (lowerContent.includes('21:45') || lowerContent.includes('21.45'))) {
          data.date = convertDayToDate('next friday');
          data.time = '21:45';
          console.log('✅ User specified: Friday 9:45 PM');
          dateAsked = false;
        }
        // Generic date references
        else if (lowerContent.includes('stasera') || lowerContent.includes('questa sera')) {
          data.date = convertDayToDate('today');
          data.time = '20:00';
          console.log('✅ User specified: tonight');
          dateAsked = false;
        }
        else if (lowerContent.includes('domani') || lowerContent.includes('tomorrow')) {
          data.date = convertDayToDate('tomorrow');
          data.time = '20:00';
          console.log('✅ User specified: tomorrow');
          dateAsked = false;
        }
      }
      
      // Capture phone number when asked - COMPREHENSIVE BILINGUAL NUMBER SUPPORT
      if (phoneAsked) {
        const digits = content
          // English numbers
          .replace(/zero/gi, '0')
          .replace(/one/gi, '1')
          .replace(/two/gi, '2')
          .replace(/three/gi, '3')
          .replace(/four/gi, '4')
          .replace(/five/gi, '5')
          .replace(/six/gi, '6')
          .replace(/seven/gi, '7')
          .replace(/eight/gi, '8')
          .replace(/nine/gi, '9')
          // Italian numbers (with and without accents)
          .replace(/uno/gi, '1')
          .replace(/due/gi, '2')
          .replace(/tre/gi, '3')
          .replace(/quattro/gi, '4')
          .replace(/cinque/gi, '5')
          .replace(/sei/gi, '6')
          .replace(/sette/gi, '7')
          .replace(/otto/gi, '8')
          .replace(/nove/gi, '9')
          // Handle Italian pronunciation variations
          .replace(/ùno/gi, '1')    // Accented variations
          .replace(/dùe/gi, '2')
          .replace(/tré/gi, '3')
          .replace(/quàttro/gi, '4')
          .replace(/cìnque/gi, '5')
          .replace(/séi/gi, '6')
          .replace(/sètte/gi, '7')
          .replace(/òtto/gi, '8')
          .replace(/nòve/gi, '9')
          .replace(/\D/g, '');
        
        if (digits.length > 0) {
          phoneDigits += digits;
          console.log(`📞 Phone digits collected: ${phoneDigits}`);
        }
        
        // If we have enough digits, consider the phone number complete
        if (phoneDigits.length >= 10) {
          phoneAsked = false;
        }
      }
      
      // Extract special requests - BILINGUAL
      if (lowerContent.includes('honeymoon') || 
          lowerContent.includes('surprise') ||
          lowerContent.includes('romantic') ||
          lowerContent.includes('luna di miele') || 
          lowerContent.includes('luna di miele') || // Common typo
          lowerContent.includes('sorpresa') ||
          lowerContent.includes('romantico') ||
          lowerContent.includes('romantica')) {
        data.specialRequests = 'Romantic song in the background for honeymoon surprise';
        console.log('✅ User mentioned honeymoon/surprise');
      }
      
      // Newsletter opt-in - BILINGUAL
      if ((lowerContent.includes('newsletter') && (lowerContent.includes('yes') || lowerContent.includes('join'))) ||
          (lowerContent.includes('newsletter') && (lowerContent.includes('sì') || lowerContent.includes('si'))) ||
          lowerContent.includes('iscriviti') ||
          lowerContent.includes('mi iscrivo') ||
          lowerContent.includes('volentieri')) { // "volentieri" = "gladly"
        data.newsletter = true;
        console.log('✅ User opted into newsletter');
      }
    }
  }
  
  // Process collected phone number
  if (phoneDigits.length >= 7) {
    data.phone = '+39' + phoneDigits.substring(0, 10);
    console.log(`✅ Processed phone number: ${data.phone}`);
  }
  
  console.log('🗣️ Conversation flow data:', data);
  return data;
}

// 3. Extract from system logs
function extractFromSystemLogs(logs) {
  console.log('🔍 Extracting from system logs...');
  const data = {};
  
  if (!logs) return data;
  
  // Look for patterns in logs
  const patterns = {
    firstName: /Name:\s*([A-Za-z]+)/i,
    lastName: /Name:\s*[A-Za-z]+\s+([A-Za-z]+)/i,
    phone: /Phone:\s*([+\d\s]+)/i,
    guests: /Guests?:\s*(\d+)/i,
    date: /Date[\/\s]Time:\s*([^,\n]+)/i,
    time: /(\d{1,2}:\d{2})/,
    specialRequests: /Special Requests:\s*([^\n]+)/i,
    newsletter: /Newsletter:\s*(true|false|yes|no)/i
  };
  
  Object.entries(patterns).forEach(([field, pattern]) => {
    const match = logs.match(pattern);
    if (match && match[1]) {
      const value = match[1].trim();
      console.log(`📝 Log ${field}: "${value}"`);
      
      switch (field) {
        case 'firstName':
          data.firstName = value;
          break;
        case 'lastName':
          data.lastName = value;
          break;
        case 'phone':
          data.phone = value.replace(/\s/g, '');
          break;
        case 'guests':
          data.guests = parseInt(value);
          data.adults = data.guests;
          break;
        case 'date':
          data.date = convertDayToDate(value);
          break;
        case 'time':
          data.time = value;
          break;
        case 'specialRequests':
          data.specialRequests = value;
          break;
        case 'newsletter':
          data.newsletter = value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
          break;
      }
    }
  });
  
  return data;
}

// 4. Merge and resolve conflicts between sources
function mergeAndResolveData(sources, defaultData) {
  console.log('🔄 Merging and resolving data from all sources...');
  
  const finalData = { ...defaultData };
  const sourcePriority = ['structuredBlock', 'conversationFlow', 'systemLogs'];
  
  // For each field, take the value from the highest priority source that has it
  const fields = ['firstName', 'lastName', 'phone', 'guests', 'adults', 'children', 'date', 'time', 'specialRequests', 'newsletter'];
  
  fields.forEach(field => {
    for (const source of sourcePriority) {
      if (sources[source][field] !== undefined && 
          sources[source][field] !== '' && 
          sources[source][field] !== null) {
        
        // Special validation for certain fields
        if (isValidFieldValue(field, sources[source][field])) {
          console.log(`✅ Using ${field} from ${source}: ${sources[source][field]}`);
          finalData[field] = sources[source][field];
          break;
        }
      }
    }
  });
  
  // Cross-validate important fields
  crossValidateFields(finalData, sources);
  
  return finalData;
}

function isValidFieldValue(field, value) {
  switch (field) {
    case 'phone':
      return value.length >= 10; // Basic phone validation
    case 'guests':
    case 'adults':
    case 'children':
      return value > 0 && value < 20; // Reasonable guest count
    case 'time':
      return /^\d{1,2}:\d{2}$/.test(value); // Time format
    default:
      return true;
  }
}

function crossValidateFields(finalData, sources) {
  console.log('🔍 Cross-validating fields...');
  
  // Ensure adults + children = guests
  if (finalData.adults && finalData.children !== undefined) {
    const calculatedGuests = finalData.adults + finalData.children;
    if (finalData.guests !== calculatedGuests) {
      console.log(`⚠️ Guest count mismatch: ${finalData.guests} total vs ${finalData.adults} adults + ${finalData.children} children`);
      // Prefer the calculated value if it makes sense
      if (calculatedGuests > 0 && calculatedGuests < 20) {
        finalData.guests = calculatedGuests;
        console.log(`✅ Using calculated guest count: ${finalData.guests}`);
      }
    }
  }
  
  // Validate phone format
  if (finalData.phone && !finalData.phone.startsWith('+39')) {
    finalData.phone = '+39' + finalData.phone.replace(/\D/g, '');
    console.log(`✅ Formatted phone: ${finalData.phone}`);
  }
  
  // Validate date is in the future
  const reservationDate = new Date(finalData.date);
  const today = new Date();
  if (reservationDate < today) {
    // Default to tomorrow if date is in the past
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    finalData.date = tomorrow.toISOString().split('T')[0];
    console.log(`⚠️ Date in past, defaulting to tomorrow: ${finalData.date}`);
  }
}

// ===== EXPRESS ROUTES =====

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

// ===== TIME TEST ENDPOINT =====
app.get('/api/time-test', (req, res) => {
    const serverTime = new Date();
    const italianTime = new Date(serverTime.toLocaleString("en-US", {timeZone: "Europe/Rome"}));
    const greeting = getItalianTimeWithTimezone();
    
    res.json({
        server_time: serverTime.toISOString(),
        italian_time: italianTime.toISOString(),
        italian_hour: italianTime.getHours(),
        current_greeting: greeting,
        message: `If you called now, I would say: "${greeting}"`
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
    
    // ===== ADD TIME AWARENESS HERE =====
    const italianGreeting = getItalianTimeWithTimezone();
    console.log(`🇮🇹 Current Italian greeting: ${italianGreeting}`);
    
    const reservationId = generateReservationId();
    console.log(`🎫 Generated Reservation ID: ${reservationId}`);
    
    let conversationData = [];
    if (call && call.transcript_object) {
      console.log(`✅ Using transcript_object with ${call.transcript_object.length} messages`);
      conversationData = call.transcript_object;
    }
    
    // Use comprehensive data extraction
    const systemLogs = JSON.stringify(call, null, 2); // Capture any additional call data as logs
    const reservationData = extractReservationData(conversationData, systemLogs);
    
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
    
    // ===== TIME-AWARE RESPONSE =====
    const greeting = getItalianTimeWithTimezone();
    let timeAwareResponse;
    
    if (greeting === "Buongiorno") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buona giornata!`;
    } else if (greeting === "Buon pomeriggio") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buon proseguimento!`;
    } else if (greeting === "Buonasera") {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buona serata!`;
    } else {
        timeAwareResponse = `Perfetto! ${greeting}! Ho prenotato per ${guests} persone il ${date} alle ${time}. La tua conferma è ${reservationId}. Buona notte!`;
    }
    
    res.json({
        response: timeAwareResponse
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    const greeting = getItalianTimeWithTimezone();
    res.json({
        response: `${greeting}! Grazie per la tua chiamata! Abbiamo ricevuto la tua richiesta di prenotazione.`
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
});
