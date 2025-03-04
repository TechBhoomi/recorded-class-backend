
-- CREATE TABLE absent_records (
--     id SERIAL PRIMARY KEY,
--     student_id INTEGER NOT NULL,
--     details JSONB NOT NULL,
-- -- approved_status BOOLEAN DEFAULT false NOT NULL,
--     createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );
CREATE TABLE absent_records (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    batch_name VARCHAR NOT NULL,
    comment TEXT NOT NULL,
    absent_date VARCHAR NOT NULL,
    approved_status BOOLEAN DEFAULT false NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE absent_records ADD COLUMN "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE absent_records ADD COLUMN "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE absent_records
ADD COLUMN video_details jsonb[] NOT NULL DEFAULT '{}';
ALTER TABLE absent_records
ADD COLUMN comment TEXT NOT NULL DEFAULT '';

CREATE TABLE download_videos (
    id SERIAL PRIMARY KEY,           
    student_id INTEGER NOT NULL,     
    type TEXT DEFAULT NULL,      
    batch_name TEXT NOT NULL, 
    requested_date timestamptz NOT NULL, 
    download_status TEXT DEFAULT NULL, 
    delete_status BOOLEAN DEFAULT FALSE NOT NULL, 
    active_upto timestamptz DEFAULT NULL, 
    file_details JSONB NOT NULL DEFAULT '[{}]'::JSONB, 
    details JSONB NOT NULL DEFAULT '[{}]'::JSONB, 
     "createdAt" timestamptz, 
     "updatedAt" timestamptz
);
