import app from './app.js';
import dotenv from 'dotenv';
dotenv.config();
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('API v2 listening on ' + PORT));

