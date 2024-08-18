const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const { s3 } = require("../middlewares/uploader");
require("dotenv").config();
const path = require("path");

const videoTranscoder = async (job, done) => {
  // remove every directory inside upload folder if any
  try {
    const files = fs.readdirSync("./uploads");

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join("./uploads", file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        fs.rmdirSync(filePath, { recursive: true });
        console.log(`${filePath} directory removed.`);
      }
    }
    console.log('All directories inside "uploads" removed successfully.');
  } catch (err) {
    console.error(`Error removing directories: ${err}`);
  }

  const qualities = [
    {
      name: "4k",
      resolution: "3840x2160",
      bitrate: "8000k",
      bandwidth: "16000000",
    },
    {
      name: "2k",
      resolution: "2560x1440",
      bitrate: "5000k",
      bandwidth: "10000000",
    },
    {
      name: "1080",
      resolution: "1920x1080",
      bitrate: "3000k",
      bandwidth: "6000000",
    },
    // {
    //   name: "720",
    //   resolution: "1280x720",
    //   bitrate: "1500k",
    //   bandwidth: "3000000",
    // },
    // {
    //   name: "480",
    //   resolution: "854x480",
    //   bitrate: "800k",
    //   bandwidth: "1600000",
    // },
  ];
  // implementation to transcode the video using FFmpeg and upload to S3
  const transcodeAndUpload = async (file, name) => {
    console.log("Transcoding started");
    const inputFilePath = file;
    console.log(file);
    fs.mkdirSync(`./uploads/${name}`);
    const outputDirPath = `./uploads/${name}`;

    // Create a promise for each quality
    const promises = [];

    for (const quality of qualities) {
      promises.push(new Promise((resolve, reject) => {
        const outputFilePath = `${outputDirPath}/${quality.name}.m3u8`;

        ffmpeg(inputFilePath)
          .outputOptions([
            `-vf scale=${quality.resolution}`,
            `-c:a aac`,
            `-b:v ${quality.bitrate}`,
            `-hls_time 10`,
            `-hls_list_size 0`,
            `-hls_segment_filename ${outputDirPath}/${quality.name}_%03d.ts`,
          ])
          .output(outputFilePath)
          .on("end", () => {
            console.log(`Transcoding for ${quality.name} completed`);
            resolve({
              name: quality.name,
              url: `${quality.name}.m3u8`,
              qualityInfo: quality,
              directory: name,
            });
          })
          .on("error", (err) => {
            console.log(`Error transcoding for ${quality.name}: ${err.message}`);
            reject(err);
          })
          .run();
      }));
    }

    // Wait for all promises to complete and generate master playlist
    Promise.all(promises)
      .then((values) => {
        console.log("finished transcoding");
        let masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n";

        values.forEach((value) => {
          console.log(value);
          masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${value.qualityInfo.bandwidth},RESOLUTION=${value.qualityInfo.resolution}\n${value.url}\n`;
        });

        fs.writeFileSync(`${outputDirPath}/master.m3u8`, masterPlaylist);
        console.log("Master playlist generated");
        return values;
      })

      .then((values) => {
        // Upload to S3
        console.log("Uploading to S3");
        const files = fs.readdirSync(outputDirPath);
        for (const file of files) {
          const filePath = `${outputDirPath}/${file}`;

          const promise = new Promise((resolve, reject) => {
            fs.readFile(filePath, (err, data) => {
              if (err) {
                console.log(`Error reading file: ${err.message}`);
                reject(err);
                return;
              }

              const params = {
                Bucket: process.env.S3_BUCKET_NAME,
                Key: `${name}/${file}`,
                Body: data,
                ContentType: "video/mp2t",
              };

              s3.upload(params, (err, data) => {
                if (err) {
                  console.log(`Error uploading file: ${err.message}`);
                  reject(err);
                  return;
                }

                console.log(`File uploaded successfully. ${data.Location}`);
                resolve(data);
              });
            });
          });

          promises.push(promise);
        }

        Promise.all(promises).then(() => {
          console.log("All files uploaded");
          done();
        });

        const newValues = values.map((value) => {
          const { qualityInfo, ...rest } = value;
          return rest;
        });

        done(null, {
          id: job.data.id,
          qualities: [
            ...newValues,
            { name: "master", url: "master.m3u8", directory: name },
          ],
        });
      })
      // .then(() => {
      //   // Delete local files
      //   console.log("Deleting local files");
      //   fs.rmdirSync(outputDirPath, { recursive: true });

      //   console.log("Local files deleted");
      // })

      .catch((err) => {
        console.log(`Error transcoding: ${err.message}`);
      });
  };

  transcodeAndUpload(
    job.data.loc,
    job.data.loc.split("/")[4].slice(0, 8) + "-" + job.data.id
  );
};
module.exports = videoTranscoder;
