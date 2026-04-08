require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));
app.use(express.json());

// SPA routes — BEFORE static middleware so they take priority over index.html
const spaFile = path.join(__dirname, 'spa.html');
['/', '/app', '/profile', '/characters'].forEach(route => {
  app.get(route, (req, res) => res.sendFile(spaFile));
});

// Cache images for 7 days
app.use('/assets', express.static('assets', { maxAge: '7d' }));
app.use(express.static('.'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/profile', require('./routes/profile'));

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));
