/* Authors: Sienna Simms, Aditya Patil, Karthik S. Vedula
 * This file contains the code for the tabs management system and rendering of charts and tables.
 */

import {data} from './editor.js';
import { PERFORMANCE_MODE, isChartAnimationEnabled } from "./editor.js";


var TESTING_MODE = false;


function showPopup(msg) {
  var popupNotif = document.getElementById("popupNotif");
  var popupNotifText = document.getElementById("popupNotifText");
  popupNotifText.innerHTML = msg;
  popupNotif.style.visibility = "visible";
}

// Object class to create charts and tables
class Graphic {
  constructor(type, xAxis, yAxis){
    this.type = type;
    this.xAxis = xAxis;
    this.yAxis = yAxis;
  }
}

// Where the tab data is stored
var tabs = [new Graphic("chart", "time", [])]; // default tab info
if(sessionStorage.tabsData)
  tabs = JSON.parse(sessionStorage.tabsData);

let list = document.getElementById("tabsList"); // list of tab elements

var chart = new ApexCharts(document.querySelector("#chart"), {
  chart: {
    type: 'scatter',
    foreColor: (sessionStorage.getItem("darkMode") == "true" ? '#ffffff' : '#373d3f')
  },
  series: [{
  }],
  xaxis: {
    
  },
})
chart.render()

// Creates an array of series keys
// @def true if only reuturns stocks for default
function seriesKeys(def){
  const series = ["time"]; // time as an option

  for (var x in data.stocks) { // gets the keys of the stocks
    series.push(x);

    if (def == false) { // not included in default
      for (var inflow in data.stocks[x].inflows) { // gets the keys of the inflows
        if (!series.includes(inflow)) { // avoids repeats
          series.push(inflow);
        }
      }
      for (var outflow in data.stocks[x].outflows) { // gets the keys of the inflows
        if (!series.includes(outflow)) { // avoids repeats
          series.push(outflow);
        }
      }    
    }
  }
  
  if (def == false){ // not included in default
    for (var y in data.converters) { // gets the keys of the variables
      series.push(y);
    }
  }

  return series;
}

// Adds the options for the x and y axes
function addOptions(){
  const series = seriesKeys(false);
  let x = document.getElementById("xAxis"); // refers to x-axis select node
  let y = document.getElementById("yAxis"); // refers to y-axis div node
  
  // Configuration for buttons of x-axis
  for (var i = 0; i < series.length; i++){
    const opt = document.createElement("option"); // Creates an option
    var node = document.createTextNode(series[i]); // Assigns text node (used exterally)
    opt.appendChild(node);
    opt.value = series[i]; // Assigns value (used interally)

    x.appendChild(opt);
  }

  // Configuration for buttos for y-axis
  for (var i = 1; i < series.length; i++){ // do not want to include time
    const row = document.createElement("tr"); // row for input
    const d1 = document.createElement("td"); // where checkboxes will go
    const d2 = document.createElement("td"); // where labels will go
    
    const opt = document.createElement("input"); // Creates an input
    opt.type = "checkbox"; // The input is a checkbox
    opt.value = series[i];
    opt.name = "yAxis";
    opt.className = "yAxisCheckbox";
    d1.appendChild(opt);

    const label = document.createElement("label"); // Creates a label
    label.for = i;
    var node = document.createTextNode(series[i]); // Assigns text node to label
    label.appendChild(node);
    d2.appendChild(label);

    // putting into the table
    row.appendChild(d1);
    row.appendChild(d2);
    y.appendChild(row);
  }
}

// Opens and initializes the form popup
function openForm(){
  if (data == null){ // ensures that the simulation has been run first
    showPopup("Run the simulation first.");
    return;
  }
  if (seriesKeys(false).length == 1){
    showPopup("Create a model first.");
    return;
  }

  // Reset any previous form state
  let form = document.getElementById("tabConfig");
  form.reset();
  resetOptions();
  
  // Add new options
  addOptions();

  // Show form and overlay
  document.getElementById("popForm").style.display = "block";
  document.getElementById("grayEffectDiv").style.display = "block";
  
  // Focus on the first radio button
  document.getElementById("table").focus();
}

// Will validate and add tab data
function submit(){
  // First check if a visualization type is selected
  let typeSelected = false;
  let form = document.forms["tabConfig"];
  for (let radio of form["model_type"]) {
    if (radio.checked) {
      typeSelected = true;
      break;
    }
  }
  if (!typeSelected) {
    showPopup("Please select either Table or Chart.");
    return false;
  }

  // Check if any Y-axis variables are selected
  let hasYAxisSelection = false;
  let inputs = document.getElementsByTagName('input');
  for (let i = 0; i < inputs.length; i++) {
    if (inputs.item(i).className == 'yAxisCheckbox' && inputs.item(i).checked) {
      hasYAxisSelection = true;
      break;
    }
  }
  
  if (!hasYAxisSelection) {
    showPopup("Please select at least one variable for the Y-axis.");
    return false;
  }

  // All validation passed, create the new tab
  initializeTab();
  return false;
}

// Resets the options so that it updates the options
function resetOptions(){
  let x = document.getElementById("xAxis"); // refers to x-axis select node
  while (x.firstChild) { // removes all child elements
    x.removeChild(x.lastChild);
  }

  let y = document.getElementById("yAxis"); // refers to y-axis div node
  while (y.firstChild) { // removes all child elements
    y.removeChild(y.lastChild);
  }
}

// Enter objects into tabs data array
function initializeTab() {
  try {
    let form = document.forms["tabConfig"];
    
    // Get all selected y axis values
    var y = [];
    let inputs = document.getElementsByTagName('input');
    for (let input of inputs) {
      if (input.className == 'yAxisCheckbox' && input.checked) {
        y.push(input.value);
      }
    }

    // Get the x-axis value with validation
    let x = form["xAxis"].value;
    if(form["model_type"].value == "table" && x != "time"){ 
      x = "time"; // auto-corrects for tables
      showPopup("The x-axis must always be time for tables. (corrected)");
    }

    // Create and add the new tab
    var tab = new Graphic(form["model_type"].value, x, y);
    tabs.push(tab);

    // Immediately configure the new tab
    configTabs();
    
    // Auto-select the newly created tab
    if (list.lastChild) {
      list.lastChild.click();
    }

    // Clean up
    document.getElementById("popForm").style.display = "none";
    document.getElementById("grayEffectDiv").style.display = "none";
    form.reset();
    resetOptions();
    
  } catch (error) {
    console.error("Error creating new tab:", error);
    showPopup("Error creating new tab. Please try again.");
  }
}

// Array listener
/* @arr array you want to listen to
   @callback function that will be called on any change inside array
 */
function listenChangesinArray(arr,callback){
     // Add more methods here if you want to listen to them
    ['pop','push','reverse','shift','unshift','splice','sort'].forEach((m)=>{
        arr[m] = function(){
                     var res = Array.prototype[m].apply(arr, arguments);  // call normal behaviour
                     callback.apply(arr, arguments);  // finally call the callback supplied
                     return res;
                 }
    });
}

// Configures dynamic tabs
function configTabs(){
  sessionStorage.tabsData = JSON.stringify(tabs); // updates session storage
  if(TESTING_MODE) 
    console.log(tabs);
  
  // reset for updating
  while (list.firstChild) { // removes all child elements
    list.removeChild(list.lastChild);
  }
  // Count chart/table indices for naming
  let chartCount = 0;
  let tableCount = 0;
  for(let j = 0; j < tabs.length; j++){
    const tab = document.createElement("div"); // Tabs are divs to allow button children
    tab.classList = "graphTabs";
    // Create tab name span
    const tabName = document.createElement("span");
    if(j == 0) {
      tabName.textContent = "Default";  // name of default tab
    } else {
      if (tabs[j].type === "chart") {
        chartCount++;
        tabName.textContent = `Chart ${chartCount}`;
      } else if (tabs[j].type === "table") {
        tableCount++;
        tabName.textContent = `Table ${tableCount}`;
      } else {
        tabName.textContent = `Tab ${j}`;
      }
    }
    tab.appendChild(tabName);
    // Add delete button after the name (if not the default tab)
    if(j != 0) {  // default tab is not deletable
      const delButton = document.createElement("button"); 
      delButton.innerHTML = '×';  // Use × symbol instead of material icon
      delButton.className = "graphTabsDelButton";
      delButton.type = "button";
      delButton.setAttribute('aria-label', 'Close tab');
      tab.appendChild(delButton);
    }
    list.appendChild(tab);
    // Add delete button event listener (only for non-default tabs)
    if(j != 0) {
      const delButton = tab.querySelector('.graphTabsDelButton');
      delButton.addEventListener("click", function(event) {
        event.stopPropagation(); // Prevent tab click when clicking delete button
        let tabText = tab.firstChild.textContent;
        // Find correct index based on type and number
        let i = j;
        tabs.splice(i, 1); // removes one value from i
        configTabs(); // reconfigure tabs
        // Switch to the previous tab or default tab
        if (i > 0) {
          list.childNodes[i-1].click(); // switches to previous tab
        } else if (list.childNodes.length > 0) {
          list.childNodes[0].click(); // switch to default tab
        }
      });
    }
    tab.addEventListener("click", function render() {
      if (data == null){ // ensures that the simulation has been run first
        showPopup("Run the simulation first.");
        return;
      }
      // Find the correct tab index by matching tab name
      let tabIndex = 0;
      if (tabName.textContent === "Default") {
        tabIndex = 0;
      } else if (tabName.textContent.startsWith("Chart ")) {
        // Find nth chart
        let n = parseInt(tabName.textContent.replace("Chart ", ""));
        let count = 0;
        for (let k = 1; k < tabs.length; k++) {
          if (tabs[k].type === "chart") {
            count++;
            if (count === n) { tabIndex = k; break; }
          }
        }
      } else if (tabName.textContent.startsWith("Table ")) {
        // Find nth table
        let n = parseInt(tabName.textContent.replace("Table ", ""));
        let count = 0;
        for (let k = 1; k < tabs.length; k++) {
          if (tabs[k].type === "table") {
            count++;
            if (count === n) { tabIndex = k; break; }
          }
        }
      } else {
        tabIndex = j;
      }
      var tabInfo = tabs[tabIndex];
      if (tabInfo.type == "chart") {
        if (PERFORMANCE_MODE == true)
          console.time('Chart Render Time'); // Measuring chart render time
        document.getElementById('chart').hidden = false;
        document.getElementById('datatable').hidden = true;
        // Set chart title
        let chartTitle = document.getElementById('chartTitle');
        if (!chartTitle) {
          chartTitle = document.createElement('h2');
          chartTitle.id = 'chartTitle';
          document.getElementById('chart').prepend(chartTitle);
        }
        chartTitle.textContent = tabName.textContent;
        var options = {
          series: [
          ],
          chart: {
            type: 'scatter',
            zoom: {
              enabled: true,
              type: 'xy'
            },
            height: "100%",
            width: "100%",
            animations: {
              enabled: isChartAnimationEnabled(),
              easing: 'linear',
              speed: 1000,
              animateGradually: {
                enabled: true,
                delay: 150
              },
              dynamicAnimation: {
                enabled: true,
                speed: 350
              }
            }
           },
          dataLabels: {
            enabled: false
          },

          legend: {showForSingleSeries: true},
          xaxis: {
            tickAmount: 10,
            labels: {
              formatter: function(val) {
                return parseFloat(val).toFixed(1)
              }
            }
          },
          yaxis: {
            forceNiceScale: false,
            labels: {
              formatter: function(val) {
                return parseFloat(val).toFixed(1)
              }
            }
          }, 
          tooltip: {
            x: {
              formatter: function(val) {
                return parseFloat(val).toFixed(10)
              }
            },
            y: {
              formatter: function(val) {
                return parseFloat(val).toFixed(10)
              }
            }
          }
        }

        var maxyValue = Number.MIN_VALUE;
        var minyValue = Number.MAX_VALUE;

        for (var yName of tabInfo.yAxis) {
          var yValues = getAllValues(yName, data);
          for (var yValue of yValues) {
            if (yValue > maxyValue) {
              maxyValue = yValue;
            }
            if (yValue < minyValue) {
              minyValue = yValue;
            }
          }
        }

        var xValues = getAllValues(tabInfo.xAxis, data);
        if(xValues == null){ // deletes tab and sends alert when data is deleted
          showPopup("There is missing data in this tab. (corrected)");
          // Delete this tab
          let tabText = this.firstChild.textContent;
          let tabIndex = tabText === "Default" ? 0 : Number(tabText.charAt(4));
          if (tabIndex > 0) { // Don't delete default tab
            tabs.splice(tabIndex, 1);
            configTabs();
            if (list.childNodes.length > 0) {
              list.childNodes[0].click(); // Switch to default tab
            }
          }
          return;
        }

        for (var yName of tabInfo.yAxis) {
          var yValues = getAllValues(yName, data);
          if(yValues == null){ // deletes tab and sends alert when data is deleted
            showPopup("There is missing data in this tab. (corrected)");
            // Delete this tab
            let tabText = this.firstChild.textContent;
            let tabIndex = tabText === "Default" ? 0 : Number(tabText.charAt(4));
            if (tabIndex > 0) { // Don't delete default tab
              tabs.splice(tabIndex, 1);
              configTabs();
              if (list.childNodes.length > 0) {
                list.childNodes[0].click(); // Switch to default tab
              }
            }
            return;
          }
          options.series.push({
            name : yName,
            data : yValues.map((x, idx) => [xValues[idx], x])
          });
        }

        options.xaxis.title = {text: tabInfo.xAxis};
        options.yaxis.min = minyValue;
        options.yaxis.max = maxyValue;

        chart.updateOptions(options, true)

        if (PERFORMANCE_MODE == true) { // Measuring chart render time
          console.timeEnd('Chart Render Time');
        }
      } else {
          if (PERFORMANCE_MODE == true)
            console.time('Table Render Time'); // Measuring table render time
        
          document.getElementById('chart').hidden = true;
          document.getElementById('datatable').hidden = false;
          // Set table title
          let tableTitle = document.getElementById('tableTitle');
          if (!tableTitle) {
            tableTitle = document.createElement('h2');
            tableTitle.id = 'tableTitle';
            document.getElementById('datatable').prepend(tableTitle);
          }
          tableTitle.textContent = tabName.textContent;
        
          var xValues = getAllValues(tabInfo.xAxis, data);
          if(xValues == null){ // deletes tab and sends alert when data is deleted
            showPopup("There is missing data in this tab. (corrected)");
            // Delete this tab
            let tabText = this.firstChild.textContent;
            let tabIndex = tabText === "Default" ? 0 : Number(tabText.charAt(4));
            if (tabIndex > 0) { // Don't delete default tab
              tabs.splice(tabIndex, 1);
              configTabs();
              if (list.childNodes.length > 0) {
                list.childNodes[0].click(); // Switch to default tab
              }
            }
            return;
          }
        
          var tableData = [];
          var tableColumns = [{
            title: "time",
            field: "time"
          }];

          for (var i = 0; i < xValues.length; i++) {
            var x = {id : i};
            x[tabInfo.xAxis] = xValues[i];

            tableData.push(x);
          }
          
        
          for (var yName of tabInfo.yAxis) {
            var yValues = getAllValues(yName, data);
            if(yValues == null){ // deletes tab and sends alert when data is deleted
              showPopup("There is missing data in this tab. (corrected)");
              // Delete this tab
              let tabText = this.firstChild.textContent;
              let tabIndex = tabText === "Default" ? 0 : Number(tabText.charAt(4));
              if (tabIndex > 0) { // Don't delete default tab
                tabs.splice(tabIndex, 1);
                configTabs();
                if (list.childNodes.length > 0) {
                  list.childNodes[0].click(); // Switch to default tab
                }
              }
              return;
            }
            for (var i = 0; i < tableData.length; i++) {
              tableData[i][yName] = yValues[i];
            }
            tableColumns.push({
              title : yName,
              field : yName,
            });
          }
        
          var table = new Tabulator("#datatable", {
            // (THIS IS NOW SET IN CSS) height:640, // set height of table (in CSS or here), this enables the Virtual DOM and improves render speed dramatically (can be any valid css height value)
            data:tableData, //assign data to table
            layout:"fitColumns", //fit columns to width of table (optional)
            columns: tableColumns,
          });
        
          table.on("tableBuilt", () => {
            //making sure table is built
          });

          if (PERFORMANCE_MODE == true) { // Measuring table render time
            console.timeEnd('Table Render Time');
          }
      }
      
      // indicates the active tab
      var dark = document.getElementById("darkThemeCSS");
      if (dark.disabled) {
        for (var t = 0; t < list.childNodes.length; t++){
          list.childNodes[t].classList = "graphTabs graphTabsInactive";
        }
        
        this.classList = "graphTabs graphTabsActive";
      } else {
        for (var t = 0; t < list.childNodes.length; t++){
          list.childNodes[t].classList = "graphTabs graphTabsInactive";
        }
        
        this.classList = "graphTabs graphTabsActive";
      }
  })
}
}

function getAllValues(name, data) {
  if (name == "time") {
    return data.timesteps;
  }
  
   for (var stock in data.stocks) {
     if (name == stock) {
       return data.stocks[stock]['values'];
     }

     for (var inflow in data.stocks[stock].inflows) {
       if (name == inflow) {
         return data.stocks[stock].inflows[inflow]['values'];
       }
     }

     for (var outflow in data.stocks[stock].outflows) {
       if (name == outflow) {
         return data.stocks[stock].outflows[outflow]['values'];
       }
     }
   }

  for (var converter in data.converters) {
    if (name == converter) {
       return data.converters[converter]['values'];
    }
  }
}


// Updates tabs buttons on side when the array is changed
listenChangesinArray(tabs, configTabs);

// Event listeners

document.addEventListener("DOMContentLoaded", function() { configTabs(); });

 // updates data and goes to default
document.getElementById("runButton").addEventListener("click", function() { 
  tabs[0] = new Graphic("chart", "time", seriesKeys(true).splice(1)); 
  configTabs(); 
  list.firstChild.click(); 
  if(TESTING_MODE) console.log(tabs);  
});

document.getElementById("addTab").addEventListener("click", openForm);
document.getElementById("submitModel").addEventListener("click", submit);
document.getElementById("closeNewTabPopup").addEventListener("click", function() {
  document.getElementById("popForm").style.display = "none"; // hide form
  document.getElementById("grayEffectDiv").style.display = "none";
  form.reset(); // reset input
  resetOptions(); // reset options
});