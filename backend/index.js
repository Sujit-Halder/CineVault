const express = require('express');
const cors = require('cors');
const routes=require('./routes');
const app = express();
const PORT=5000;

app.use(cors({
    origin: "http://localhost:5173",
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Example route
app.get('/api', (req, res) => {
    res.send('API working!');
});

app.use('/api', routes);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));