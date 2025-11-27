const express = require('express');
const Airtable = require('airtable');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Italian date/time formatting helper
function formatDateForAirtable(italianDate) {
  // Handle various Italian date formats
  // "domani" -> tomorrow, "25 gennaio" -> 2024-01-25, etc.
  // For now, assume YYYY-MM-DD format or pass through
  return italianDate; // You might want to add proper date parsing later
}

function formatTimeForAirtable(italianTime) {
  // Handle Italian time formats
  // "19:30", "7 di sera", "7 PM" -> "19:30"
  return italianTime; // You might want to add proper time parsing later
}

// Test route - shows server is working
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
    timestamp: new Date().toISOString(),
    airtable: process.env.AIRTABLE_TOKEN ? 'Connected' : 'Not configured'
  });
});

// Create reservation endpoint - UPDATED FOR ITALIAN INPUT
app.post('/api/reservations', async (req, res) => {
  try {
    let { name, date, time, guests, email, phone, specialRequests } = req.body;
    
    // Simple validation
    if (!name || !date || !time || !guests) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['name', 'date', 'time', 'guests'],
        received: req.body
      });
    }

    // If Airtable is configured, save to Airtable
    if (process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID) {
      const airtable = new Airtable({
        apiKey: process.env.AIRTABLE_TOKEN
      });
      
      const base = airtable.base(process.env.AIRTABLE_BASE_ID);
      
      // Extract first and last name from full name (handles Italian names)
      const nameParts = name.split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Format date/time for Airtable (Italian input)
      const formattedDate = formatDateForAirtable(date);
      const formattedTime = formatTimeForAirtable(time);
      
      const record = await base('Reservations').create([
        {
          "fields": {
            "First Name": firstName,
            "Last Name": lastName,
            "Email": email || '',
            "Phone Number": phone || '',
            "Reservation Date": formattedDate,
            "Arrival Time": formattedTime,
            "Total People": parseInt(guests),
            "Special Requests": specialRequests || '', // Italian text OK here
            "Reservation Status": "Pending",
            "Reservation Type": "Dinner + Show",
            "Dinner Count": parseInt(guests),
            "Show-Only Count": 0,
            "Kids Count": 0,
            "Newsletter Opt-In": false,
            "Language": "Italian" // New field to track language
          }
        }
      ]);

      return res.json({
        success: true,
        message: 'Prenotazione salvata con successo!', // Italian response
        reservation: {
          id: record[0].id,
          name, date: formattedDate, time: formattedTime, guests, email, phone,
          confirmation: `JAZ-${record[0].id.slice(-6).toUpperCase()}`
        }
      });
    }

    // If no Airtable config
    res.json({
      success: true,
      message: 'Prenotazione ricevuta!',
      reservation: {
        name, date, time, guests, email, phone,
        status: 'Simulated'
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Errore nel salvare la prenotazione', // Italian error
      details: error.message 
    });
  }
});

// Get all reservations
app.get('/api/reservations', async (req, res) => {
  try {
    if (process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID) {
      const airtable = new Airtable({
        apiKey: process.env.AIRTABLE_TOKEN
      });
      
      const base = airtable.base(process.env.AIRTABLE_BASE_ID);
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

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
});
