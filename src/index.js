// require('es6-promise').polyfill();

/*
Tableau's internal browser is old. In order to make dealing with multiple
asynchronous API calls, waiting for them and processing them *in order*, we use
a combination of browserify (with babelify) and some polyfills

Using the CLI:

browserify ./src/index.js -o bundle.js -t [ babelify --presets [ @babel/preset-env ] ]

 */

/* =================================
Polyfills and library functions
================================== */ 

require('babel-polyfill');
// special polyfill for fetch support (not provided by babel-polyfill)
require('fetch-ie8')
// function from lodash for allowing us to combine parallel arrays into a single 'table'
import zip from "lodash.zip"

(function () {
  // Create the connector object
 const myConnector = tableau.makeConnector();

  /* =================================
  Schemas
  ================================== */ 

  myConnector.getSchema = function (schemaCallback) {
   const rates_schema = [
      {
        id: "name",
        alias: "Name of Metric",
        dataType: tableau.dataTypeEnum.string
      },
      {
        id: "this_wk",
        alias: "This Week",
        dataType: tableau.dataTypeEnum.float
      },
      {
        id: "prev_wk",
        alias: "Previous Week",
        dataType: tableau.dataTypeEnum.float
      },
      {
        id: "three_wk",
        alias: "Three Weeks Ago",
        dataType: tableau.dataTypeEnum.float
      },
    ];
    
   const counts_schema =  [
     {
       id: "name",
       alias: "Name of Metric",
       dataType: tableau.dataTypeEnum.string
     },
     {
       id: "this_wk",
       alias: "This Week",
       dataType: tableau.dataTypeEnum.int
     },
     {
       id: "prev_wk",
       alias: "Previous Week",
       dataType: tableau.dataTypeEnum.int
     },
     {
       id: "three_wk",
       alias: "Three Weeks Ago",
       dataType: tableau.dataTypeEnum.int
     },
   ];

    /* =================================
    Schema Representatives
    ================================== */
  
  
    const bulletins = {
      id: "bulletins",
      alias: "Bulletins",
      columns: [...counts_schema]
    };
  
    const bulletin_rates = {
      id: "bulletin_rates",
      alias: "Bulletin Rates",
      columns: [...rates_schema]
    };

   const subscribers = {
      id: "subscribers",
      alias: "Subscribers",
      columns: [...counts_schema]
    };
  
    const subscriber_rates = {
      id: "subscriber_rates",
      alias: "Subscriber Rates",
      columns: [...rates_schema]
    };

    //const bulletin_details = {
    //   id: "bulletin_details",
    //   alias: "Bulletin Details",
    //   columns: [...counts_schema]
    // };

   const topics = {
      id: "topics",
      alias: "Topic Engagement + Subscribers",
      columns: [...counts_schema]
    };

    schemaCallback([bulletins, bulletin_rates, subscribers, subscriber_rates, topics /*, engagement, bulletin_details */ ]);
  };



  myConnector.getData = function (table, doneCallback) {
 
    /* =================================
    Fetching Functions
    ================================== */ 

    // TODO: If there are >= 20 results in `bulletin_activity_details` array, call again and create a new matrix

    // make a single call or recursion for `next` links 
    const fetcher = async (url, acc) => {  
      return await window.fetch(url, {
        method: "GET",
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/hal+json',
          'X-AUTH-TOKEN': key
        }
      })
      .then(async res => {
       const prime = await res.json()
        console.log("api call: " + url);
        console.log("prime:")
        console.table(prime)
        console.log("ok?:" + res.ok)
        if (table.tableInfo.id === "bulletin_details") {
          if (res.ok) {
           const cur = prime["bulletin_activity_details"]
            console.log("in bulletin_details...")
            if (typeof cur === "undefined") {
              console.log("cur == undefined")
              return acc
            } else if (cur.length < 20) {
             const last = acc.concat(cur)
              console.log("Less than 20 results: ")
              console.table(last)
              return last // bulletin details is an array
            } else if (cur.length === 20) {
             const next = acc.concat(cur)
              console.log("More than 20 results: ")
              console.table(next)
              console.log("recurring fetcher")
              await fetcher(`https://cors-e.herokuapp.com/https://api.govdelivery.com${prime._links.next.href}`, next)
            }
          } else {
            console.log("no results in `next`... acc = ")
            console.table(acc)
            return acc
          }
        } else {
          return prime // summaries is an object
        }
      })
    }

    // handle Many calls in one weekly bundle (e.g., Engagement Rates)
    const arrayFetcher = async urls => {
      
      const responses = await urls.map(async url => {
        const result = await window.fetch(url, {
          method: "GET",
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/hal+json',
            'X-AUTH-TOKEN': key
          }
        })
  
        const prime = await result.json()
        console.log("prime:")
        console.table(prime)
        return prime
      })
      
      const promiseArr = await Promise.all(responses)
      
      return promiseArr.reduce(async (acc, res, i) => {
        
        const last = await acc
        const coll = await res
        // evens are engagement rate and odds are topic summaries
        if (table.tableInfo.id === "topics") {
          if (i % 2 === 0) {
           let todo = {}
            todo[`${coll["name"]} Engagement Rate`] = coll["engagement_rate"]
            console.log("engagement_rate: ")
            console.table(todo)
            console.log("last:")
            console.table(last)
            return Object.assign(last, todo)
          } else {
            let todo = {}
            todo[`${coll["name"]} Subscribers`] = coll["total_subscriptions_to_date"]
            console.log("Subscribers: ")
            console.table(todo)
            console.log("last:")
            console.table(last)
            return Object.assign(last, todo)
          }
        }
      // must resolve the value in order for the next tick to access the contents
      }, Promise.resolve({}))
      // will be an array of Promises containing objects
    }
  
    console.log("Iteration 59")
    
    /* =================================
    General Purpose Derivative Functions
    ================================== */ 
    
    const makeRateFromObj = (source, col, numProp, denomProp) => {
      console.log("in makeRateFromObj")
      const result = source[col][numProp] / source[col][denomProp]

      console.log("result: " + result)
      return result
    }

    const makeSumFromObj = (source, col, ...counts) => {
      console.log("in makeSumFromObj ...counts = " + counts)
      const result = counts.reduce((acc, cur) => acc + source[col][cur], 0)
    
      console.log("after await -> counts.reduce...: " + result)
      return result
    } 

    const makeSumFromArr = (source, col, ...counts) => {
      console.log("in makeSumFromArr ...counts = ")
      const result = source[col].reduce((acc, cur) => counts.reduce((a, b) => acc + a + cur[b], 0), 0)

      console.table(result)
      return result
    }
  
  
    const augmentDumpNZip = (source, ...pushers) => {
      let keys_ = Object.keys(source[0]);
      let wk1_vals = Object.values(source[0]);
      let wk2_vals = Object.values(source[1]);
      let wk3_vals = Object.values(source[2]);
    
      let wks = [wk1_vals, wk2_vals, wk3_vals]
    
      return zip(
        pushers.reduce((acc, pusher) => acc.concat(pusher.name), keys_),
        // pusher handles a single week
        ...wks.map( (wk, i) => wk.concat(pushers.map( p => p.pusher(source, i)))));
    }
  
    const createDumpNZIP = (source, ...pushers) => {
      
      return zip(
        pushers.map( pusher => pusher.name), // keys
        ...[[],[],[]].map( (wk, i) => wk.concat(pushers.map( p => p.pusher(source, i)))))
    }


    /* =================================
    Data Getters
    ================================== */ 

    const get_data = async calls => {

      const results = calls.map(url => fetcher(url, []))

      // For Object results, returns an array of promises containing objects
      // For Array results, returns an array of promises containing arrays of objects
      let dump = await Promise.all(results);


      // control logic for derived/calculated fields
      if (table.tableInfo.id === "bulletin_rates") {
        const pushOpenRates = {
          name: "open_rate",
          pusher: (source, col) => makeRateFromObj(source, col, "opens_count", "total_delivered")
        }

        return createDumpNZIP(dump, pushOpenRates)

      } else if (table.tableInfo.id === "bulletin_details") {

        const pushTgiSums = {
          name: "total_digital_impressions",
          pusher: (source, col) => makeSumFromArr(source, col, "nonunique_opens_count", "nonunique_clicks_count")
        }

        return createDumpNZIP(dump, pushTgiSums)

      } else if (table.tableInfo.id === "subscribers") {
        
        const pushNewSubs = {
          name: "new_subscribers",
          pusher: (source, col) => makeSumFromObj(source, col, "direct_subscribers", "overlay_subscribers", "upload_subscribers", "all_network_subscribers")
        }

        return augmentDumpNZip(dump, pushNewSubs)

      } else  if (table.tableInfo.id === "subscriber_rates") {
        
        const pushUnsubRate = {
          name: "unsubscribe_rate",
          pusher: (source, col) => makeRateFromObj(source, col, "deleted_subscribers", "total_subscribers")
        }
  
        return createDumpNZIP(dump, pushUnsubRate)
        
      } else {

        const keys_ = Object.keys(dump[0]);
        const wk1_vals = Object.values(dump[0]);
        const wk2_vals = Object.values(dump[1]);
        const wk3_vals = Object.values(dump[2]);

        return zip(keys_, wk1_vals, wk2_vals, wk3_vals);

      }
    }

    const get_dataArr = async calls => {

      const results = calls.map( urls => arrayFetcher(urls))

      // For Object results, returns an array of promises containing objects
      // For Array results, returns an array of promises containing arrays of objects
      const dump = await Promise.all(results);


      // control logic for derived/calculated fields
      if (table.tableInfo.id === "topics") {
        // const pushOpenRates = {
        //   name: "open_rate",
        //   pusher: (source, wk, col) => wk.push(makeRateFromObj(source, col, "opens_count", "total_delivered"))
        // }
        
        // return createDumpNZIP(dump, pushOpenRates)
        console.log(`
        =====================
        COMPLETE
        =====================`)
        const keys_ = Object.keys(dump[0]);
        const wk1_vals = Object.values(dump[0]);
        const wk2_vals = Object.values(dump[1]);
        const wk3_vals = Object.values(dump[2]);
  
        return zip(keys_, wk1_vals, wk2_vals, wk3_vals);
      }
    }


    /* =================================
    Table Constructors
    ================================== */ 

    const dataGetter = urlList => {
      get_data(urlList)
        .then(result => {
          table.appendRows(
            result.map(k => ({
              "name": k[0],
              "this_wk": k[1],
              "prev_wk": k[2],
              "three_wk": k[3]
            })
            )
          )
          doneCallback()
        })
    }

    const arrDataGetter = urlList => {
      get_dataArr(urlList)
        .then(result => {
          table.appendRows(
            result.map(k => ({
                "name": k[0],
                "this_wk": k[1],
                "prev_wk": k[2],
                "three_wk": k[3]
              })
            )
          )
          doneCallback()
        })
    }
 
  
    /* =================================
    Topics List
    ================================== */
  
    const topics = {
      // "America Counts"                : "USCENSUS_11939",
      // "Census Academy"                : "USCENSUS_11971",
      // "Census Jobs"                   : "USCENSUS_11941",
      // "Census Partnerships"           : "USCENSUS_11958",
      // "Census Updates"                : "USCENSUS_11926",
      // "Census Updates for Business"   : "USCENSUS_11927",
      // "Data Visualization Newsletter" : "USCENSUS_11932",
      // "Statistics in Schools"         : "USCENSUS_11940",
      // "Stats for Stories"             : "USCENSUS_11960"
      "State Data Center Leads": "42162" // only one currently visible... rest TODO
    }
  
    /* =================================
    URL Creating Functions
    ================================== */
    
    // account number
    const account = "11723";
  
    // Data passed through lifecycle phases (Interactive -> Data Gathering) via tableau.connectionData
    const cd_data = JSON.parse(tableau.connectionData);
    const key = cd_data.key
    const _end = cd_data.end_date
    
    // Latest date from user input
    const end_date = new Date(_end);
  
    // function for creating dates formatted for Granicus API
    const makeDate = (days_ago) => {
      // create date from number of 'days_ago' from
      const date = new Date(new Date().setDate(end_date.getDate() - days_ago));
      const month = date.getUTCMonth() + 1; //jan = 0
      const day = date.getUTCDate();
      const year = date.getUTCFullYear();
      return `${year}-${month}-${day}`
    }
  
    const makeURLDateRange = (end, start) => `start_date=${makeDate(start)}&end_date=${makeDate(end)}`
  
    const base_url = `https://cors-e.herokuapp.com/https://api.govdelivery.com/api/v2/accounts/${account}/`;
  
    // Bulletins summary url:
    const BSURL = "reports/bulletins/summary"
    // Subscriber summary url:
    const SSURL = "reports/subscriber_activity/summary"
    // Bulletins report url:
    const BURL = "reports/bulletins"
    // Topic Summary
    const makeTopicURL = topicID => `reports/topics/${topicID}`
    // Engagement rate url
    const makeEngageURL = topicID => `reports/topics/${topicID}/engagement_rate`
  
    const makeURL = (extURL, _end, _start) => `${base_url}${extURL}?${makeURLDateRange(_end, _start)}`
  
    const makeWklyURLArr = (str, ...days) => days.map( day => makeURL(str, day, day + 7))
  
    const makeWkFnArr = (_topics, func, _end, _start) => Object.values(_topics).map( id => makeURL(func(id), _end, _start))
  
    // const engage_1wk = Object.values(topics).map(topic => makeEngagement_1wk(topic))
    const engage_1wk = makeWkFnArr(topics, makeEngageURL, 0, 7)
    const topicS_1wk = makeWkFnArr(topics, makeTopicURL, 0, 7)
    const engage_2wk = makeWkFnArr(topics, makeEngageURL, 7, 14)
    const topicS_2wk = makeWkFnArr(topics, makeTopicURL, 7, 14)
    const engage_3wk = makeWkFnArr(topics, makeEngageURL, 14, 21)
    const topicS_3wk = makeWkFnArr(topics, makeTopicURL, 14, 21)
  
    const interleave = (arr1, arr2) => arr1.reduce((acc, cur, i) => acc.concat(cur, arr2[i]), [])
  
    const EplusS_1wk = interleave(engage_1wk, topicS_1wk)
    const EplusS_2wk = interleave(engage_2wk, topicS_2wk)
    const EplusS_3wk = interleave(engage_3wk, topicS_3wk)
  
    // Bulletin Summary
    const bulletinsCallList = makeWklyURLArr(BSURL, 0, 7, 14)
  
    // Subscriber Summary
    const subscribersCallList = makeWklyURLArr(SSURL, 0, 7, 14)
  
    // Bulletin Detail
    // const callList3 = makeWklyURLArr(BURL, 0, 7, 14)
  
    // Engagement Rates = Array of arrays of URLS
    const topicsCallList = [EplusS_1wk, EplusS_2wk, EplusS_3wk]
  
  
    
    /* =================================
    Table Targets
    ================================== */ 

    if (table.tableInfo.id === "bulletins") {
      dataGetter(bulletinsCallList)
    } else if (table.tableInfo.id === "bulletin_rates") {
      dataGetter(bulletinsCallList)
    } else if (table.tableInfo.id === "subscribers") {
      dataGetter(subscribersCallList)
    } else if (table.tableInfo.id === "subscriber_rates") {
      dataGetter(subscribersCallList)
    } else if (table.tableInfo.id === "topics") {
      arrDataGetter(topicsCallList)
    }
    // else if (table.tableInfo.id === "bulletin_details") {
    //   dataGetter(callList3)
    // }


  }


  tableau.registerConnector(myConnector);

  // Create event listeners for when the user submits the form
  $(document).ready(function () {
    $("#submitButton").click(function () {

      // Get user input and store it in an object
      let pass = {
        key: $('#apiKey').val().trim(),
        end_date: $('#end_date').val().trim()
      };

      // Tableau requires that `connectionData` be a string
      tableau.connectionData = JSON.stringify(pass);

      // This will be the data source name in Tableau
      tableau.connectionName = "Granicus WDC";

      // Completes the 'interactive phase'
      tableau.submit()
    })
  });
})();




