import cheerio from 'cheerio';
import got from 'got';
import { load } from 'cjson';
import fs from 'fs';
import path from 'path';

const docsSrc = load('src/docs.json');


const createRequeredFolders = (filename) => {
  const folders = filename.split(path.sep).slice(0, -1);
  if (folders.length) {
    // create folder path if it doesn't exist
    folders.reduce((last, folder) => {
      const folderPath = last ? last + path.sep + folder : folder;
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath);
      }
      return folderPath;
    });
  }
};

const writePdfFile = (filename, pdfBufferData) => {
  createRequeredFolders(filename);

  let writeStream = fs.createWriteStream(filename);
  writeStream.write(pdfBufferData, 'binary');
  writeStream.on('finish', () => {
    console.log(`Saved ${filename}`);
  });
  writeStream.end();
};

const writeJsonFile = (filename, stringContent) => {
  createRequeredFolders(filename);

  fs.writeFileSync(filename, stringContent);
};

const getDocBaseData = async (docId) => {
  const response = await got(
    `http://grls.rosminzdrav.ru/Grls_View_v2.aspx?routingGuid=${docId}`
  );

  let $ = cheerio.load(response.body);
  const cookie = response.headers['set-cookie']
    .map((c) => c.replace('; path=/', ''))
    .join(';');
  const regNum = $('#ctl00_plate_RegNr').val();
  const regId = $('#ctl00_plate_hfIdReg').val();

  const tradeName = $('#ctl00_plate_TradeNmR').val();

  return { regNum, regId, tradeName, docId, cookie };
};

const addExtrasToDocs = async (docs) => {
  return Promise.all(
    docs.map(async (docId) => {
      const { regNum, regId, tradeName, cookie } = await getDocBaseData(docId);

      const dataResponse = await got.post(
        `https://grls.rosminzdrav.ru/GRLS_View_V2.aspx/AddInstrImg`,
        {
          headers: { cookie, 'Content-Type': 'application/json' },
          body: `{regNumber: '${regNum}', idReg: '${regId}'}`,
        }
      );

      const docExtras = JSON.parse(JSON.parse(dataResponse.body).d);
      const promises = [];

      docExtras.Sources.forEach((src) => {
        src.Instructions.forEach((instruction) => {
          instruction.Images.forEach(async (image) => {
            promises.push(got(
              `https://grls.rosminzdrav.ru${image.Url}`
            ).then(pdfResponse => {
              if (!pdfResponse) console.log(image.Url);
              pdfResponse && writePdfFile(`data${image.Url}`, pdfResponse.rawBody);
            }));

            
          });
        });
      });

      await Promise.all(promises)

      return {
        docId,
        regId,
        regNum,
        tradeName,
        data: docExtras,
      };
    })
  );
};
let json = JSON.stringify(await addExtrasToDocs(docsSrc), null, 2);

writeJsonFile(`data${path.sep}docsWithExtras.json`, json);
