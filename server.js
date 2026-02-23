require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.static('.'));  // serves your HTML/CSS/JS files

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/upload', require('./routes/upload'));

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));