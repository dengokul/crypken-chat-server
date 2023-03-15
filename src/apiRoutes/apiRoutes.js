import fs from "fs";
import path from "path";
import { promises as fsp } from "fs";
import express from "express";
import formidable from "formidable"; // to handle file uploads
import extractTextFromFile from "../services/extractTextFromFile.js";
import { createEmbeddings } from "../services/createEmbeddings.js";
import { searchFileChunks } from "../services/searchFileChunks.js";
import { completionStream } from "../services/openai.js";
import pdfParse from "pdf-parse";

// Disable the default body parser to handle file uploads
export const config = { api: { bodyParser: false } };
const Router = express.Router();
const MAX_FILES_LENGTH = 2000 * 3;

// Router.post('/process-file', async (req, res) => {
//     // Create a formidable instance to parse the request as a multipart form
//     const form = new formidable.IncomingForm();
//     try {
//         const { fields, files } = await new Promise((resolve, reject) => {
//             form.parse(req, (err, fields, files) => {
//                 if (err) {
//                     reject(err);
//                 } else {
//                     resolve({ fields, files });
//                 }
//             });
//         });
// const file = files.file;
//         if (!file || Array.isArray(file) || file.size === 0) {
//             res.status(400).json({ error: "Invalid or missing file" });
//             return;
//         }

//         const text = await extractTextFromFile({
//             filepath: file.filepath,
//             filetype: file.mimetype ?? "",
//         });

//         const { meanEmbedding, chunks } = await createEmbeddings({
//             text,
//         });

//         res.status(200).json({ text, meanEmbedding, chunks });
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     } finally {
//         // Always send a response, even if it is empty
//         res.end();
//     }
// });

function copyFile(source, target, cb) {
    var cbCalled = false;

    var rd = fs.createReadStream(source);
    rd.on("error", function (err) {
        done(err);
    });
    var wr = fs.createWriteStream(target);
    wr.on("error", function (err) {
        done(err);
    });
    wr.on("close", function (ex) {
        done();
    });
    rd.pipe(wr);

    function done(err) {
        if (!cbCalled) {
            cb(err);
            cbCalled = true;
        }
    }
}

Router.post('/process-file', async (req, res) => {
    // Create a formidable instance to parse the request as a multipart form
    const form = new formidable.IncomingForm();
    try {
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({ fields, files });
                }
            });
        });
        const file = files.file;

        if (!file || Array.isArray(file) || file.size === 0) {
            res.status(400).json({ error: "Invalid or missing file" });
            return;
        }
        // remove all files before copy new file
        var dir = "files";
        // for (const file of await fs.readdir(directory)) {
        //     await fs.unlink(path.join(directory, file));
        // }
        fs.readdirSync(dir).forEach(f => fs.rmSync(`${dir}/${f}`));
        // copy new file
        var __dirname = path.resolve();
        var tempFilePath = files.file.filepath;
        var projectFilePath = __dirname + '/files/' + files.file.originalFilename;

        fs.rename(tempFilePath, projectFilePath, function (err) {
        });

        res.status(200).json({ text: "" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        // Always send a response, even if it is empty
        res.end();
    }
});

Router.post('/search-file-chunks', async (req, res) => {
    try {
        const searchQuery = req.body.searchQuery;

        const files = req.body.files;

        const maxResults = req.body.maxResults;

        if (!searchQuery) {
            res.status(400).json({ error: "searchQuery must be a string" });
            return;
        }

        if (!Array.isArray(files) || files.length === 0) {
            res.status(400).json({ error: "files must be a non-empty array" });
            return;
        }

        if (!maxResults || maxResults < 1) {
            res
                .status(400)
                .json({ error: "maxResults must be a number greater than 0" });
            return;
        }

        // const searchResults = await searchFileChunks({
        //     searchQuery,
        //     files,
        //     maxResults,
        // });

        res.status(200).json({ searchResults: [] });
    } catch (error) {
        console.error(error);

        res.status(500).json({ error: "Something went wrong" });
    }
});

Router.post('/get-answer-from-files', async (req, res) => {
    const fileChunks = req.body.fileChunks;

    const question = req.body.question;

    if (!Array.isArray(fileChunks)) {
        res.status(400).json({ error: "fileChunks must be an array" });
        return;
    }

    if (!question) {
        res.status(400).json({ error: "question must be a string" });
        return;
    }

    try {
        const filesString = fileChunks
            .map((fileChunk) => `###\n\"${fileChunk.filename}\"\n${fileChunk.text}`)
            .join("\n")
            .slice(0, MAX_FILES_LENGTH);

        console.log(filesString);

        const prompt =
            `Given a question, try to answer it using the content of the file extracts below, and if you cannot answer, or find a relevant file, just output \"I couldn't find the answer to that question in your files.\".\n\n` +
            `If the answer is not contained in the files or if there are no file extracts, respond with \"I couldn't find the answer to that question in your files.\" If the question is not actually a question, respond with \"That's not a valid question.\"\n\n` +
            `In the cases where you can find the answer, first give the answer. Then explain how you found the answer from the source or sources, and use the exact filenames of the source files you mention. Do not make up the names of any other files other than those mentioned in the files context. Give the answer in markdown format.` +
            `Use the following format:\n\nQuestion: <question>\n\nFiles:\n<###\n\"filename 1\"\nfile text>\n<###\n\"filename 2\"\nfile text>...\n\nAnswer: <answer or "I couldn't find the answer to that question in your files" or "That's not a valid question.">\n\n` +
            `Question: ${question}\n\n` +
            `Files:\n${filesString}\n\n` +
            `Answer:`;

        const stream = completionStream({
            prompt,
            model: "text-davinci-003",
        });

        // Set the response headers for streaming
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        });

        // Write the data from the stream to the response
        for await (const data of stream) {
            res.write(data);
        }

        // End the response when the stream is done
        res.end();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Something went wrong" });
    }
});

Router.post('/get-answer', async (req, res) => {
    // const fileChunks = req.body.fileChunks;

    const question = req.body.question;
    const maxResults = 10;

    // STEP 1

    // var file = fs.createWriteStream("files/Fluency.pdf");
    // var file = fs.createReadStream("files/Fluency.pdf");

    // var __dirname = path.resolve();
    // const directoryPath = path.join(__dirname, 'files');
    // fs.readdir(directoryPath, function (err, files) {
    //     if (err) {
    //         return console.log('Unable to scan directory: ' + err);
    //     }
    //     files.forEach(function (file) {
    //         console.log('file 1', fs.readFile(file));
    //     });
    // });

    // res.status(200).json({ rrr: "Something went wrong" });
    var dirFiles = await fsp.readdir('files');
    // const filetype = file.mimetype ?? "";
    const filename = dirFiles[0];
    const filepath = `files/${filename}`;
    const filetype = "application/pdf";
    // const filesize = 12434543;
    const text = await extractTextFromFile({
        filepath: filepath,
        filetype: filetype,
    });

    const { meanEmbedding, chunks } = await createEmbeddings({
        text,
    });

    const files = [{
        name: filename,
        // url: URL.createObjectURL(filepath),
        // type: filetype,
        // size: filesize,
        expanded: false,
        embedding: meanEmbedding,
        chunks,
        extractedText: text,
    }];

    // STEP 2
    const fileChunks = await searchFileChunks({
        searchQuery: question,
        files,
        maxResults,
    });

    try {
        const filesString = fileChunks
            .map((fileChunk) => `###\n\"${fileChunk.filename}\"\n${fileChunk.text}`)
            .join("\n")
            .slice(0, MAX_FILES_LENGTH);

        const prompt =
            `Given a question, try to answer it using the content of the file extracts below, and if you cannot answer, or find a relevant file, just output \"I couldn't find the answer to that question in your files.\".\n\n` +
            `If the answer is not contained in the files or if there are no file extracts, respond with \"I couldn't find the answer to that question in your files.\" If the question is not actually a question, respond with \"That's not a valid question.\"\n\n` +
            // `In the cases where you can find the answer, first give the answer. Then explain how you found the answer from the source or sources, and use the exact filenames of the source files you mention. Do not make up the names of any other files other than those mentioned in the files context. Give the answer in markdown format.` +
            `In the cases where you can find the answer, than give the answer in markdown format.` +
            `Use the following format:\n\nQuestion: <question>\n\nFiles:\n<###\n\"filename 1\"\nfile text>\n<###\n\"filename 2\"\nfile text>...\n\nAnswer: <answer or "I couldn't find the answer to that question in your files" or "That's not a valid question.">\n\n` +
            `Question: ${question}\n\n` +
            `Files:\n${filesString}\n\n` +
            `Answer:`;

        const stream = completionStream({
            prompt,
            model: "text-davinci-003",
        });

        // Set the response headers for streaming
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        });

        // Write the data from the stream to the response
        for await (const data of stream) {
            res.write(data);
        }

        // End the response when the stream is done
        res.end();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Something went wrong" });
    }
});

export default Router;