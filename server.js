require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Dummy user
const USERS = {
  "client": "1234"
};

// ✅ Test route
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// 🔐 Login API
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (USERS[username] === password) {
    const token = jwt.sign({ username }, "secretkey");
    return res.json({ token });
  }

  res.status(401).send("Invalid credentials");
});

// 📊 Data API
app.get("/data", async (req, res) => {

  const url = "https://us-east-1-1.aws.cloud2.influxdata.com/api/v2/query?org=sriot";

  const query = `
    from(bucket: "iot_data")
      |> range(start: -2d)
      |> filter(fn: (r) => r._measurement == "dust")
      |> filter(fn: (r) => r._field == "value")
  `;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Token " + process.env.INFLUX_TOKEN,
        "Content-Type": "application/vnd.flux"
      },
      body: query
    });

    const text = await response.text();

    console.log(text);

    const lines = text.split("\n");
    let values = [];

    lines.forEach(line => {
      const cols = line.split(",");
      if (cols.length > 6 && !isNaN(parseFloat(cols[6]))) {
        values.push(parseFloat(cols[6]));
      }
    });

    res.json({ values });

  } catch (error) {
    console.log(error);
    res.status(500).send("Error fetching data");
  }
});

// ▶ Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});