require('dotenv').config();
const express = require('express')
const cors = require('cors');
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000

const admin = require("firebase-admin");

const serviceAccount = require("./trip-hub-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  console.log("header", req.headers.authorization)

  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized Access' })
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('decoded in the token', decoded)
    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
}


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
    const userCollection = db.collection('users');
    const ticketsCollection = db.collection('tickets');
    const bookingsCollection = db.collection('bookings');
    const paymentCollection = db.collection('payments');
    const vendorsCollection = db.collection('vendors');

    // middleware with database access- before allowing admin activity
    // must be used after verifyFBToken middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email }
      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    const verifyVendor = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email }
      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'vendor') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }

    // user related apis
    app.get('/users', verifyFBToken, async (req, res) => {
      const adminEmail = req.decoded_email;

      const cursor = userCollection.find({ email: { $ne: adminEmail } },)
        .sort({ createdAt: -1 });

      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/users/role', verifyFBToken, async (req, res) => {
      const user = await userCollection.findOne({ email: req.decoded_email })
      res.send({ role: user?.role || 'user' })
    })

    app.get('/users/:id', async (req, res) => {
      const id = req.params.id;
      const user = await userCollection.findOne({ _id: new ObjectId(id) });
      res.send(user)
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: 'user exists' })
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    app.patch('/update-role', verifyFBToken, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;

      if (!email || !role) {
        return res.status(400).send({ message: 'Missing email or role' });
      }

      //  Update user role
      const userResult = await userCollection.updateOne(
        { email },
        { $set: { role } }
      );

      //  If role is vendor → create vendor profile
      let vendorResult = null;

      if (role === 'vendor') {
        const existingVendor = await vendorsCollection.findOne({ email });

        if (!existingVendor) {
          vendorResult = await vendorsCollection.insertOne({
            name: req.body.name || 'Unknown Vendor',
            image: req.body.name,
            email,
            status: 'approved', // since admin is assigning
            createdAt: new Date(),
            updatedAt: null
          });
        }
      }

      res.send({
        userModified: userResult.modifiedCount,
        vendorCreated: vendorResult?.insertedId || null
      });
    });



    // tickets apis

    // get all tickets data
    app.get('/tickets', async (req, res) => {
      const query = { isVisible: true }
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
        .find({ status: 'approved', isVisible: true })
        .sort({ createdAt: -1 }) // newest first
        .limit(6)
        .toArray();

      res.send(result);
    });


    app.get('/tickets/advertised', async (req, res) => {
      const result = await ticketsCollection
        .find({ status: 'approved', isAdvertised: true, isVisible: true })
        .toArray();

      res.send(result);
    });

    app.get('/tickets/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await ticketsCollection.findOne(query);
      res.send(result);
    })

    // save a ticket data in db
    app.post('/tickets', async (req, res) => {
      const ticketData = req.body;
      const result = await ticketsCollection.insertOne(ticketData);
      res.send(result);
    })

    app.patch('/tickets/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const updatedFields = {};
      const {
        status,
        price,
        departureDate,
        departureTime
      } = req.body;

      if (status !== undefined) {
        updatedFields.status = status;
      }
      if (price !== undefined) {
        updatedFields.price = price;
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

    app.patch('/tickets/advertise/:id', verifyFBToken, verifyAdmin, async (req, res) => {
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


    app.delete('/tickets/:id', verifyFBToken, verifyVendor, async (req, res) => {
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

    app.patch('/bookings/:id', verifyFBToken, verifyVendor, async (req, res) => {
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

    // payment related apis
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const usdAmount = parseInt(paymentInfo.totalPrice / 120) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: usdAmount,
              product_data: {
                name: `Please pay for: ${paymentInfo.ticketTitle}`
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          bookingId: paymentInfo.bookingId,
          ticketId: paymentInfo.ticketId,
          ticketTitle: paymentInfo.ticketTitle,
          vendorEmail: paymentInfo.vendorEmail
        },
        customer_email: paymentInfo.userEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      console.log(session)
      res.send({ url: session.url })
    })

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== 'paid') {
        return res.status(400).send({ message: 'Payment not completed' });
      }

      const transactionId = session.payment_intent;

      // Prevent duplicate payment record
      const paymentExist = await paymentCollection.findOne({ transactionId });
      if (paymentExist) {
        return res.send({ message: 'Already processed' });
      }

      const bookingId = session?.metadata.bookingId;

      const bookingUpdateResult = await bookingsCollection.updateOne(
        {
          _id: new ObjectId(bookingId),
          paymentStatus: { $ne: 'paid' }
        },
        {
          $set: { paymentStatus: 'paid' }
        }
      );


      if (bookingUpdateResult.modifiedCount === 0) {
        return res.send({ message: 'Booking already paid' });
      }


      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId)
      });


      const ticketResult = await ticketsCollection.updateOne(
        {
          _id: new ObjectId(booking.ticketId),
          quantity: { $gte: booking.quantity }
        },
        {
          $inc: { quantity: -booking.quantity }
        }
      );

      if (ticketResult.modifiedCount === 0) {

        await bookingsCollection.updateOne(
          { _id: booking._id },
          { $set: { paymentStatus: 'pending' } }
        );

        return res.status(400).send({
          message: 'Not enough ticket quantity'
        });
      }

      const payment = {
        amount: session.amount_total / 100,
        currency: session.currency,
        customerEmail: session.customer_email,
        ticketTitle: session.metadata.ticketTitle,
        vendorEmail: session.metadata.vendorEmail,
        bookingId,
        transactionId,
        paymentStatus: session.payment_status,
        paidAt: new Date()
      };

      await paymentCollection.insertOne(payment);

      res.send({
        success: true,
        message: 'Payment processed successfully'
      });
    });

    app.get('/payments', verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      console.log(req.decoded_email)
      const query = {}
      if (email) {
        query.customerEmail = email;
        if (email && email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result)
    })

    // vendor related apis
    app.get('/vendors', async (req, res) => {
      const { status } = req.query;
      const query = {}

      if (status) {
        query.status = status;
      }

      const cursor = vendorsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/vendor/dashboard-stats', verifyFBToken, verifyVendor, async (req, res) => {
      const email = req.decoded_email;

      const [revenue, sold, added] = await Promise.all([
        paymentCollection.aggregate([
          { $match: { vendorEmail: email } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$amount' }
            }
          }
        ]).toArray(),

        bookingsCollection.aggregate([
          {
            $match: {
              vendorEmail: email,
              paymentStatus: 'paid'
            }
          },
          {
            $group: {
              _id: null,
              totalTicketsSold: { $sum: '$quantity' }
            }
          }
        ]).toArray(),

        ticketsCollection.aggregate([
          {
            $match: {
              "vendor.email": email,
              status: 'approved',
              isVisible: true
            }
          },
          {
            $group: {
              _id: null,
              totalTicketsAdded: { $sum: '$totalQuantity' }
            }
          }
        ]).toArray()
      ]);

      res.send({
        totalRevenue: revenue[0]?.totalRevenue || 0,
        totalTicketsSold: sold[0]?.totalTicketsSold || 0,
        totalTicketsAdded: added[0]?.totalTicketsAdded || 0
      });
    });

    app.post('/vendors', verifyFBToken, async (req, res) => {
      const { name, image } = req.body;
      const email = req.decoded_email;

      // basic validation
      if (!email || !name) {
        return res.status(400).send({ message: 'Missing required fields' });
      }

      // prevent duplicate vendor application
      const existingVendor = await vendorsCollection.findOne({ email });

      if (existingVendor) {
        return res.status(409).send({ message: 'Vendor already exists' });
      }

      const vendor = {
        name,
        image: image || null,
        email,
        status: 'pending',        // default status
        createdAt: new Date(),
        updatedAt: null
      };

      const result = await vendorsCollection.insertOne(vendor);
      res.send(result);
    });


    app.patch('/vendors/fraud/:email', verifyFBToken, verifyAdmin, async (req, res) => {

      const email = req.params.email;

      // 1 Mark vendor as fraud
      const vendorResult = await vendorsCollection.updateOne(
        { email },
        { $set: { status: 'fraud' } }
      );

      // 2 Downgrade user role
      const userResult = await userCollection.updateOne(
        { email },
        { $set: { role: 'user' } }
      );

      // 3 Hide ALL tickets from this vendor
      const ticketResult = await ticketsCollection.updateMany(
        { "vendor.email": email },
        {
          $set: {
            isVisible: false,
            status: 'blocked'
          }
        }
      );

      res.send({
        vendorResult,
        userResult,
        ticketResult
      });
    });

    app.patch('/vendors/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const { status } = req.body;
      const id = req.params.id;

      const allowedStatus = ['approved', 'rejected', 'pending'];
      if (!allowedStatus.includes(status)) {
        return res.status(400).send({ message: 'Invalid status' });
      }

      const session = client.startSession();

      try {
        session.startTransaction();

        const vendor = await vendorsCollection.findOne(
          { _id: new ObjectId(id) },
          { session }
        );

        if (!vendor) {
          await session.abortTransaction();
          return res.status(404).send({ message: 'Vendor not found' });
        }

        await vendorsCollection.updateOne(
          { _id: vendor._id },
          { $set: { status, updatedAt: new Date() } },
          { session }
        );

        if (status === 'approved') {
          await userCollection.updateOne(
            { email: vendor.email },
            { $set: { role: 'vendor' } },
            { session }
          );
        }

        await session.commitTransaction();
        res.send({ success: true });

      } catch (error) {
        await session.abortTransaction();
        res.status(500).send({ message: 'Failed to update vendor' });
      } finally {
        session.endSession();
      }
    });



    app.delete('/vendors/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await vendorsCollection.deleteOne(query);
      res.send(result);
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