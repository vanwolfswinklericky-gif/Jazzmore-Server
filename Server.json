const express = require('express');
const Airtable = require('airtable');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

// Create reservation endpoint
app.post('/api/reservations', async (req, res) => {
  try {
    const { name, date, time, guests, email, phone } = req.body;
    
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
      
      const record = await base('Reservations').create([
        {
          "fields": {
            "Name": name,
            "Email": email || '',
            "Phone": phone || '',
            "Date": date,
            "Time": time,
            "Guests": parseInt(guests),
            "Status": "Confirmed",
            "Created": new Date().toISOString()
          }
        }
      ]);

      return res.json({
        success: true,
        message: 'Reservation saved to Airtable!',
        reservation: {
          id: record[0].id,
          name, date, time, guests, email, phone,
          confirmation: `JAZ-${record[0].id.slice(-6).toUpperCase()}`
        }
      });
    }

    // If no Airtable config, just return success
    res.json({
      success: true,
      message: 'Reservation received! (Airtable not configured yet)',
      reservation: {
        name, date, time, guests, email, phone,
        status: 'Simulated - Configure Airtable to save real data'
      },
      nextSteps: 'Add AIRTABLE_BASE_ID environment variable'
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to create reservation',
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
      message: 'Connect Airtable to see real reservations',
      instructions: 'Set AIRTABLE_BASE_ID environment variable in Render'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Jazzamore server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`✅ Health: https://your-app.onrender.com/health`);
});