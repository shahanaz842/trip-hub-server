require('dotenv').config();
const express = require('express')
const cors = require('cors');
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const port = process.env.PORT || 3000


// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j32vxdc.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('trip_hub_db');
    // const userCollection = db.collection('users');
    const ticketsCollection = db.collection('tickets');
    const bookingsCollection = db.collection('bookings');

    // tickets apis

    // save a ticket data in db
    app.post('/tickets', async (req, res) => {
      const ticketData = req.body;
      const result = await ticketsCollection.insertOne(ticketData);
      res.send(result);
    })

    // get all tickets data
    app.get('/tickets', async (req, res) => {
      const query = {}
      const { email, status } = req.query;

      if (email) {
        query["vendor.email"] = email;
      }

      if (status) {
        query.status = status;
      }
      const result = await ticketsCollection.find(query).toArray();
      res.send(result);
    })

    app.get('/tickets/latest', async (req, res) => {

      const result = await ticketsCollection
        .find({ status: 'approved' })
        .sort({ createdAt: -1 }) // newest first
        .limit(6)
        .toArray();

      res.send(result);
    });


    app.get('/tickets/advertised', async (req, res) => {
      const result = await ticketsCollection
        .find({ status: 'approved', isAdvertised: true })
        .toArray();

      res.send(result);
    });

    app.get('/tickets/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ticketsCollection.findOne(query);
      res.send(result);
    })


    app.patch('/tickets/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updatedFields = {};
      const {
        status,
        price,
        quantity,
        departureDate,
        departureTime
      } = req.body;

      if (status !== undefined) {
        updatedFields.status = status;
      }
      if (price !== undefined) {
        updatedFields.price = price;
      }
      if (quantity !== undefined) {
        updatedFields.quantity = quantity;
      }
      if (departureDate !== undefined) {
        updatedFields.departureDate = departureDate;
      }
      if (departureTime !== undefined) {
        updatedFields.departureTime = departureTime;
      }

      const updatedDoc = {
        $set: updatedFields
      }
      const result = await ticketsCollection.updateOne(query, updatedDoc)
      res.send(result)
    })

    app.patch('/tickets/advertise/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const { isAdvertised } = req.body;
      const updatedDoc = {
        $set: { isAdvertised }
      }

      // If trying to advertise → check limit
      if (isAdvertised === true) {
        const advertisedCount = await ticketsCollection.countDocuments({
          isAdvertised: true,
        });

        if (advertisedCount >= 6) {
          return res.status(400).send({
            message: 'Maximum 6 tickets can be advertised',
          });
        }
      }

      const result = await ticketsCollection.updateOne(query, updatedDoc);

      res.send(result);
    });


    app.delete('/tickets/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ticketsCollection.deleteOne(query);
      res.send(result)
    })

    // booking api
    app.post('/bookings', async (req, res) => {
      const bookingInfo = req.body;
      const result = await bookingsCollection.insertOne(bookingInfo);
      res.send(result)
    })

    app.get('/bookings', async (req, res) => {
      const query = {}
      const { email, bookingStatus } = req.query;
      // /bookings?email=''&
      if (email) {
        query.userEmail = email;
      }

      if (bookingStatus) {
        query.bookingStatus = bookingStatus;
      }

      const cursor = bookingsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.patch('/bookings/:id', async (req, res) => {
      const bookingStatus = req.body.bookingStatus;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          bookingStatus: bookingStatus
        }
      }
      const result = await bookingsCollection.updateOne(query, updatedDoc)
      res.send(result)
    })



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello World, time for a trip!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})