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

// 🔐 JWT Middleware (ADD THIS)
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(403).send("No token provided");
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, "secretkey", (err, decoded) => {
    if (err) {
      return res.status(401).send("Invalid token");
    }

    req.user = decoded;
    next();
  });
}

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

// 📊 Data API (PROTECTED 🔐)
app.get("/data", verifyToken, async (req, res) => {

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