const csv = require("csvtojson");
const fs = require("fs");
const { promisify } = require("util");
const _ = require("lodash");

const colorMapping = {
  democrat: {
    r: 0,
    g: 0,
    b: 1
  },
  republican: {
    r: 1,
    g: 0,
    b: 0
  },
  green: {
    r: 0,
    g: 1,
    b: 0
  },
  NA: {
    r: 1,
    g: 1,
    b: 1
  }
};

const writeFileAsync = promisify(fs.writeFile);

(async () => {
  try {
    const filePath = "./countypres_2000-2016.csv";
    const jsonArray = await csv().fromFile(filePath);

    const groupedArrayByYear = _.chain(jsonArray)
      .groupBy("year")
      .mapValues(val =>
        _.chain(val)
          .groupBy("FIPS")
          .mapValues(county => {
            const totalVotes = parseInt(county[0].totalvotes, 10);
            return county.reduce(
              (acc, val) => {
                const percent = Math.round(
                  (parseInt(val.candidatevotes, 10) / totalVotes) * 100
                );
                if (percent > acc.percent) {
                  return {
                    color: colorMapping[val.party],
                    percent
                  };
                }
                return acc;
              },
              {
                color: colorMapping.NA,
                percent: 0
              }
            );
          })
          .value()
      )
      .value();

    const promises = _.map(groupedArrayByYear, (val, key) =>
      writeFileAsync(`${key}.json`, JSON.stringify(val))
    );

    await Promise.all(promises);
  } catch (e) {
    console.error(e);
  }
})();
