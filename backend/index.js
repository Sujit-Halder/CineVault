const express = require('express');
const cors = require('cors');
require('dotenv').config();
const routes = require('./routes');
const app = express();
const PORT = process.env.PORT;

app.use(cors({
    origin: process.env.WEBSITE,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Example route
app.get('/api', (req, res) => {
    res.send('API working!');
});

app.use('/api', routes);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));