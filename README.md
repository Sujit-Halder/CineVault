# Movie-Tracker

This WebApp is a interface to store movies.
It provide no user authentication.
It is made specially for local hosting.

In Backend ,write your own .env file with\n

WEBSITE='http://localhost:3000'
PORT=3001

WEBSITE is where the your webapp is hosted,for cors origin.
PORT ,in which port your server is running

In Frontend, write/edit .env file with\n

VITE_API_URL='http://localhost:3001'  //for api i.e backend server
VITE_SERVER_IP='localhost'            // frontend server ip
VITE_SERVER_PORT=3000                 // frontend server port
