import express from 'express';
import router from './routes/index.js';

const app = express();
const port = 3000;


app.use(express.json());

app.use('/v1', router);


app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
