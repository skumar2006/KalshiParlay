# Database Setup Guide

## PostgreSQL Setup

This extension now uses PostgreSQL to persist parlay bets across sessions.

### Option 1: Local PostgreSQL Installation

1. **Install PostgreSQL** (if not already installed):
   ```bash
   # macOS
   brew install postgresql@15
   brew services start postgresql@15
   
   # Ubuntu/Debian
   sudo apt-get install postgresql postgresql-contrib
   sudo systemctl start postgresql
   ```

2. **Create a database**:
   ```bash
   # Connect to PostgreSQL
   psql postgres
   
   # Create database
   CREATE DATABASE kalshi_parlay;
   
   # Create a user (optional)
   CREATE USER kalshi_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE kalshi_parlay TO kalshi_user;
   
   # Exit
   \q
   ```

3. **Add to your `.env` file**:
   ```
   DATABASE_URL=postgresql://kalshi_user:your_password@localhost:5432/kalshi_parlay
   ```

### Option 2: Cloud PostgreSQL (Recommended for Production)

#### Using Supabase (Free Tier Available)

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the database to be provisioned
3. Go to Project Settings > Database
4. Copy the "Connection string" (URI format)
5. Add to your `.env` file:
   ```
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
   ```

#### Using Neon (Free Tier Available)

1. Go to [neon.tech](https://neon.tech) and create a new project
2. Copy the connection string
3. Add to your `.env` file:
   ```
   DATABASE_URL=postgresql://[user]:[password]@[host]/[database]?sslmode=require
   ```

#### Using Railway (Free Tier Available)

1. Go to [railway.app](https://railway.app) and create a new project
2. Add a PostgreSQL database
3. Copy the `DATABASE_URL` from the variables
4. Add to your `.env` file

### Updated .env File

Your `.env` file should now include the `DATABASE_URL`:

```bash
# Server Configuration
PORT=4000

# Kalshi API Configuration
KALSHI_API_BASE_URL=https://api.elections.kalshi.com/trade-api/v2
KALSHI_API_KEY=your_real_kalshi_api_key_here
KALSHI_API_KEY_ID=your_api_key_id_here
KALSHI_PRIVATE_KEY_PATH=./keys/kalshi_private_key.pem

# PostgreSQL Database Configuration
DATABASE_URL=postgresql://username:password@host:5432/database_name

# Environment (optional)
NODE_ENV=development
```

## Database Schema

The database will be automatically initialized when you start the server. It creates two tables:

### `users` Table
- `id`: Serial primary key
- `user_id`: Unique varchar(255) - the user's generated ID
- `created_at`: Timestamp

### `parlay_bets` Table
- `id`: Serial primary key
- `user_id`: Foreign key to users.user_id
- `market_id`: Varchar(255) - the Kalshi market ID
- `market_title`: Text - the market title
- `image_url`: Text - the market image URL
- `option_id`: Varchar(255) - the selected option/contract ID
- `option_label`: Varchar(255) - the option label
- `prob`: Decimal(5,2) - the probability percentage
- `created_at`: Timestamp

## Testing the Database Connection

After setting up your database and updating the `.env` file:

1. Install the new dependency:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. You should see:
   ```
   [DB] Database initialized successfully
   Kalshi backend listening on http://localhost:4000
   ```

4. If you see any database errors, check:
   - Your `DATABASE_URL` is correct
   - The database server is running
   - You have network access to the database
   - Your credentials are correct

## API Endpoints

The following parlay endpoints are now available:

- `GET /api/parlay/:userId` - Get all parlay bets for a user
- `POST /api/parlay/:userId` - Add a bet to the parlay
- `DELETE /api/parlay/:userId/:betId` - Remove a specific bet
- `DELETE /api/parlay/:userId` - Clear all bets for a user

## How It Works

1. **User Identification**: Each user gets a unique ID stored in Chrome's local storage
2. **Adding Bets**: When you click "Add to Parlay", the bet is saved to PostgreSQL
3. **Persistence**: Your parlay persists across browser sessions and even if you close the extension
4. **Placing Bets**: When you click "Place Your Bet", the parlay is cleared from the database

## Troubleshooting

### Connection Errors

If you see `ECONNREFUSED` errors:
- Check that PostgreSQL is running
- Verify your `DATABASE_URL` is correct
- Make sure the database exists

### SSL Errors

Some cloud providers require SSL. If you get SSL errors, add `?sslmode=require` to your connection string:
```
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

### Permission Errors

If you get permission errors:
- Make sure your database user has the necessary permissions
- Try granting all privileges: `GRANT ALL PRIVILEGES ON DATABASE kalshi_parlay TO your_user;`


