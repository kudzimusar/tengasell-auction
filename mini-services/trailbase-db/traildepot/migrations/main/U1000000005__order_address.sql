-- Checkout delivery address (GIS displayName, e.g. "Hauna, Zimbabwe") so
-- order tracking maps route to the destination the buyer actually chose,
-- instead of falling back to the buyer's profile city.
ALTER TABLE orders ADD COLUMN address TEXT;
