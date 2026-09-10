import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import meditationRoutes from './routes/meditationRoutes.js';
import eventsRoutes from './routes/eventsRoutes.js';
import communityRoutes from './routes/communityRoutes.js';
import volunteerRoutes from './routes/volunteerRoutes.js';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Spiritual Platform API is running.');
});

app.use('/api/auth', authRoutes);
app.use('/api/meditation', meditationRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/api/events', eventsRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/volunteering', volunteerRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

