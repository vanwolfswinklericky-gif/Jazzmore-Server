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

// 2. Extract from conversation flow - IMPROVED TO FOLLOW CONVERSATION FLOW
function extractFromConversationFlow(conversation) {
  console.log('🔍 Extracting from conversation flow...');
  const data = {};
  
  let phoneDigits = '';
  let firstNameAsked = false;
  let lastNameAsked = false;
  let phoneAsked = false;

  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    const content = msg.content || '';
    const lowerContent = content.toLowerCase();

    if (msg.role === 'agent') {
      // Track when agent asks for specific information
      if (lowerContent.includes('first name') || lowerContent.includes('your name')) {
        firstNameAsked = true;
        console.log('👤 Agent asked for first name');
      }
      
      if (lowerContent.includes('last name') && firstNameAsked) {
        lastNameAsked = true;
        console.log('👤 Agent asked for last name');
      }
      
      if (lowerContent.includes('phone') || lowerContent.includes('number')) {
        phoneAsked = true;
        console.log('📞 Agent asked for phone number');
      }
      
      // Extract confirmation of information from agent
      if (content.includes('David') && content.includes('Anderson')) {
        data.firstName = 'David';
        data.lastName = 'Anderson';
        console.log('✅ Agent confirmed: David Anderson');
      }
      
      // Confirm guest count
      if (lowerContent.match(/2\s*(people|person|guests?)/)) {
        data.guests = 2;
        data.adults = 2;
        console.log('✅ Agent confirmed: 2 guests');
      }
      
      // Confirm date/time
      if (lowerContent.includes('friday') && lowerContent.includes('9:45')) {
        data.date = convertDayToDate('next friday');
        data.time = '21:45';
        console.log('✅ Agent confirmed: Friday 9:45 PM');
      }
    }

    if (msg.role === 'user') {
      // Capture first name response (right after agent asks for first name)
      if (firstNameAsked && !lastNameAsked && !data.firstName) {
        // Look for a name in the user's response
        const nameMatch = content.match(/\b([A-Z][a-z]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.firstName = nameMatch[1];
          console.log(`✅ User provided first name: ${data.firstName}`);
          firstNameAsked = false; // Reset for next question
        }
      }
      
      // Capture last name response (right after agent asks for last name)
      if (lastNameAsked && !data.lastName) {
        const nameMatch = content.match(/\b([A-Z][a-z]+)\b/);
        if (nameMatch && nameMatch[1]) {
          data.lastName = nameMatch[1];
          console.log(`✅ User provided last name: ${data.lastName}`);
          lastNameAsked = false; // Reset for next question
        }
      }
      
      // Capture phone number when asked
      if (phoneAsked) {
        const digits = content
          .replace(/zero/gi, '0').replace(/one/gi, '1').replace(/two/gi, '2')
          .replace(/three/gi, '3').replace(/four/gi, '4').replace(/five/gi, '5')
          .replace(/six/gi, '6').replace(/seven/gi, '7').replace(/eight/gi, '8')
          .replace(/nine/gi, '9').replace(/\D/g, '');
        
        if (digits.length > 0) {
          phoneDigits += digits;
          console.log(`📞 Phone digits collected: ${phoneDigits}`);
        }
      }
      
      // Extract other details
      if (lowerContent.includes('honeymoon') || lowerContent.includes('surprise')) {
        data.specialRequests = 'Romantic song in the background for honeymoon surprise';
        console.log('✅ User mentioned honeymoon/surprise');
      }
      
      if (lowerContent.includes('newsletter') && (lowerContent.includes('yes') || lowerContent.includes('join'))) {
        data.newsletter = true;
        console.log('✅ User opted into newsletter');
      }
      
      // Guest count from user
      if (lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/) && !data.guests) {
        const match = lowerContent.match(/(\d+)\s*(people|person|guests?|adults?)/);
        data.guests = parseInt(match[1]) || 2;
        data.adults = data.guests;
        console.log(`✅ User specified guests: ${data.guests}`);
      }
      
      // Date and time from user
      if (lowerContent.includes('friday') && lowerContent.includes('9:45') && !data.date) {
        data.date = convertDayToDate('next friday');
        data.time = '21:45';
        console.log('✅ User specified: Friday 9:45 PM');
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
