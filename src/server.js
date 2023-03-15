import express from 'express';
import cors from 'cors';
import apiRoutes from './apiRoutes/apiRoutes.js';
import bodyParser from 'body-parser';

const app = express()

app.use(bodyParser.urlencoded({
  extended: false
}));

app.use(bodyParser.json());

app.use(cors())
app.use(express.json())

app.get('/', async (req, res) => {
  res.status(200).send({
    message: 'Hello from Crypken!'
  })
})

app.use("/api", apiRoutes);

app.listen(5000, () => console.log('AI server started on http://localhost:5000'))