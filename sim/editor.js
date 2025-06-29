/* Authors: Karthik S. Vedula, Sienna Simms, adapted from https://gojs.net/latest/samples/systemDynamics.html
 * This file uses the GoJS library to create a system dynamics editor.  Additionally, there is an equation editing table, 
 * which allows the user to edit the equations and characteristics of the objects in the model.
 */

var PERFORMANCE_MODE = true; // For testing runtime
export {PERFORMANCE_MODE};

import { Simulation } from "./engine.js";
import { translate } from "./translator.js";
import { CurvedLinkReshapingTool } from "./CurvedLinkReshapingTool.js";

// SD is a global variable, to avoid polluting global namespace and to make the global
// nature of the individual variables obvious.
var SD = {
    mode: "pointer",   // Set to default mode.  Alternatives are "node" and "link", for
    // adding a new node or a new link respectively.
    itemType: "pointer",    // Set when user clicks on a node or link button.
    nodeCounter: { stock: 0, cloud: 0, variable: 0, valve: 0 }
};

var myDiagram;   // Declared as global
var sim = new Simulation();
var data;

// Updates the "save status" text in the header
var lastEditDate = new Date();
var lastExportDate = new Date();
var unsavedEdits = false;
var hasExportedYet = false;
function updateSaveStatus() {
    let current = new Date();
    document.getElementById("saveStatus").innerHTML = 
    `${unsavedEdits ? "Unsaved Edits!" : "No Unsaved Edits"} (Last Edit: ${formatDeltaTime(current - lastEditDate)})<br>` +
    `Last Exported: ${hasExportedYet ? formatDeltaTime(current - lastExportDate) : "-"}`;
}
function formatDeltaTime(ms) {
    let seconds = ms / 1000;
    if (seconds < 60) return `Just Now`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
    
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);
    minutes %= 60;
    if (minutes > 0) return `${hours}h ${minutes}m ago`;
    return `${hours}h`;
}
updateSaveStatus();
setInterval(updateSaveStatus, 10000);

function init() {    
    // Since 2.2 you can also author concise templates with method chaining instead of GraphObject.make
    // For details, see https://gojs.net/latest/intro/buildingObjects.html
    const $ = go.GraphObject.make;

    myDiagram = $(go.Diagram, "myDiagram",
        {
            "undoManager.isEnabled": true,
            allowLink: false,  // linking is only started via buttons, not modelessly
            "animationManager.isEnabled": false,

            "linkingTool.portGravity": 0,  // no snapping while drawing new links
            "linkingTool.doActivate": function () {  // an override must be function, not using => ES6 shorthand
                // change the curve of the LinkingTool.temporaryLink
                this.temporaryLink.curve = (SD.itemType === "flow") ? go.Link.None : go.Link.Bezier;
                this.temporaryLink.path.stroke = (SD.itemType === "flow") ? "blue" : "orange";
                this.temporaryLink.path.strokeWidth = (SD.itemType === "flow") ? 5 : 1;
                go.LinkingTool.prototype.doActivate.call(this);
            },
            "linkReshapingTool": new CurvedLinkReshapingTool(),
            // override the link creation process
            "linkingTool.insertLink": function (fromnode, fromport, tonode, toport) {  // method override must be function, not =>
                // to control what kind of Link is created,
                // change the LinkingTool.archetypeLinkData's category
                myDiagram.model.setCategoryForLinkData(this.archetypeLinkData, SD.itemType);
                // Whenever a new Link is drawng by the LinkingTool, it also adds a node data object
                // that acts as the label node for the link, to allow links to be drawn to/from the link.
                this.archetypeLabelNodeData = (SD.itemType === "flow") ? { category: "valve" } : null;
                // also change the text indicating the condition, which the user can edit
                this.archetypeLinkData.text = SD.itemType;

                // only allow flow links from a stock or cloud and to a stock or cloud
                if (SD.itemType === "flow" && (fromnode.category !== "stock" && fromnode.category !== "cloud" || tonode.category !== "stock" && tonode.category !== "cloud")) {
                    return null;
                }

                // do not allow influences to go into a stock or a cloud
                if (SD.itemType === "influence" && (tonode.category === "stock" || tonode.category === "cloud")) {
                    return null;
                }

                return go.LinkingTool.prototype.insertLink.call(this, fromnode, fromport, tonode, toport);
            },

            "clickCreatingTool.archetypeNodeData": {},  // enable ClickCreatingTool
            "clickCreatingTool.isDoubleClick": false,   // operates on a single click in background
            // but only in "node" creation mode
            "clickCreatingTool.canStart": function () {  // method override must be function, not =>
                return SD.mode === "node" && go.ClickCreatingTool.prototype.canStart.call(this);
            },
            // customize the data for the new node (even includes valve of a flow link)
            "clickCreatingTool.insertPart": function (loc) {  // method override must be function, not =>
                SD.nodeCounter[SD.itemType] += 1;
                var newNodeId = SD.itemType + SD.nodeCounter[SD.itemType];

                while (myDiagram.model.findNodeDataForKey(newNodeId) !== null) { // make sure the key is unique
                    SD.nodeCounter[SD.itemType] += 1;
                    newNodeId = SD.itemType + SD.nodeCounter[SD.itemType];
                }

                this.archetypeNodeData = {
                    key: newNodeId,
                    category: SD.itemType,
                    label: newNodeId
                };
                return go.ClickCreatingTool.prototype.insertPart.call(this, loc);
            }
        });

    // install the NodeLabelDraggingTool as a "mouse move" tool
    myDiagram.toolManager.mouseMoveTools.insertAt(0, new NodeLabelDraggingTool());

    // add panning
    myDiagram.toolManager.panningTool.isEnabled = true;
    // store the last mouse-down event's position
    // disable drag selection
    myDiagram.toolManager.dragSelectingTool.isEnabled = false;

    // when the document is modified, add a "*" to the title
    myDiagram.addDiagramListener("Modified", e => {
        document.title = document.title.replace(/\*.*/, "");
    });

    // add input listener which updates the table whenever the diagram model changes
    myDiagram.addModelChangedListener(e => {
        // ignore unimportant Transaction events
        if (!e.isTransactionFinished) return;
        
        // check for each ghost if there is a corresponding non-ghost, if not, remove the ghost
        for (var i = 0; i < myDiagram.model.nodeDataArray.length; i++) {
            if (myDiagram.model.nodeDataArray[i].category === "cloud") { // clouds don't have labels, and don't have ghosts
                continue;
            }

            if (myDiagram.model.nodeDataArray[i].label[0] !== '$') { // if the label doesn't have a '$' in front of it, it is not a ghost
                continue;
            }

            var node = myDiagram.model.nodeDataArray[i];
            var nonGhostExists = false;
            for (var j = 0; j < myDiagram.model.nodeDataArray.length; j++) {
                if ((myDiagram.model.nodeDataArray[j].label === node.label.substring(1)) && (myDiagram.model.nodeDataArray[j].category === node.category)) { // if there is a non-ghost with the same label and the same category
                    nonGhostExists = true;
                }
            }

            if (!nonGhostExists) { // remove the ghost
                if (node.category === "valve") { // if the ghost is a valve, remove the corresponding flow link
                    for (var j = 0; j < myDiagram.model.linkDataArray.length; j++) {
                        if (myDiagram.model.linkDataArray[j].category === "flow" && myDiagram.model.linkDataArray[j].labelKeys[0] === node.key) {
                            myDiagram.model.removeLinkData(myDiagram.model.linkDataArray[j]);
                        }
                    }
                }

                // remove the node
                myDiagram.model.removeNodeData(node);

                loadTableToDiagram(); // delete the links as well
            }
        }

        updateTable();
        // don't do this if model is empty
        if (myDiagram.model.nodeDataArray.length !== 0) {
            // Update the "last edited" date
            let oldModel = sessionStorage.modelData;
            let newModel = myDiagram.model.toJson();
            sessionStorage.modelData = newModel;
            if (oldModel != newModel) {
                lastEditDate = new Date();
                unsavedEdits = true;
                updateSaveStatus();
            }
        }
    });

    // generate unique label for valve on newly-created flow link
    myDiagram.addDiagramListener("LinkDrawn", e => {
        var link = e.subject;
        if (link.category === "flow") {
            myDiagram.startTransaction("updateNode");
            SD.nodeCounter.valve += 1;
            var newNodeId = "flow" + SD.nodeCounter.valve;

            while (!labelValidator(undefined, "", newNodeId)) { // make sure the key is unique
                SD.nodeCounter.valve += 1;
                newNodeId = "flow" + SD.nodeCounter.valve;
            }

            var labelNode = link.labelNodes.first();
            myDiagram.model.setDataProperty(labelNode.data, "label", newNodeId);
            myDiagram.commitTransaction("updateNode");

            updateTable(); // add new row to table
            loadTableToDiagram(); // update diagram with new table data
        }
    });

    buildTemplates();

    myDiagram.model = go.Model.fromJson("{ \"class\": \"GraphLinksModel\", \"linkLabelKeysProperty\": \"labelKeys\", \"nodeDataArray\": [],\"linkDataArray\": [] }"); // default if no model is loaded
}

function buildTemplates() {    // COLORS (Switches depending on theme)
    var fillColor = "#f0f0f0";
    var textColor = "black";
    let currentTheme = sessionStorage.getItem("currentTheme") || 'light';
    if (currentTheme === 'dark') {
        fillColor = "#888888";
        textColor = "black";
    }

    // Since 2.2 you can also author concise templates with method chaining instead of GraphObject.make
    // For details, see https://gojs.net/latest/intro/buildingObjects.html
    const $ = go.GraphObject.make;

    // helper functions for the templates
    function nodeStyle() {
        return [
            {
                type: go.Panel.Spot,
                layerName: "Background",
                locationObjectName: "SHAPE",
                selectionObjectName: "SHAPE",
                locationSpot: go.Spot.Center
            },
            new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify)
        ];
    }

    function shapeStyle() {
        return {
            name: "SHAPE",
            stroke: "black",
            fill: fillColor,
            portId: "", // So a link can be dragged from the Node: see /GraphObject.html#portId
            fromLinkable: true,
            toLinkable: true
        };
    }

    function textStyle() {
        return [
            {
                stroke: textColor,
                font: "bold 11pt helvetica, bold arial, sans-serif",
                margin: 2,
                editable: true
            },
            new go.Binding("text", "label").makeTwoWay()
        ];
    }

    // Node templates
    var fillStock =  "#72c6ff";

    myDiagram.nodeTemplateMap.add("stock",
        $(go.Node, nodeStyle(),
            $(go.Shape, shapeStyle(),
                new go.Binding("fill", "label", function (label) { return isGhost(label) ? "#ffffff" : fillStock;}), // change color if ghost ($ in front of label)
                { desiredSize: new go.Size(50, 30),
                    fill: "#ffcc99"
                }),
            $(go.TextBlock, textStyle(),
                {
                    _isNodeLabel: true,  // declare draggable by NodeLabelDraggingTool
                    alignment: new go.Spot(0.5, 0.5, 0, 30),    // initial value
                    isMultiline: false,
                    textValidation: labelValidator, // make sure the label is unique
                },
                new go.Binding("alignment", "label_offset", go.Spot.parse).makeTwoWay(go.Spot.stringify))
        ));

    myDiagram.nodeTemplateMap.add("cloud",
        $(go.Node, nodeStyle(),
            $(go.Shape, shapeStyle(),
                {
                    figure: "Cloud",
                    desiredSize: new go.Size(30, 30),
                    fill: "#e3f3ff" // very light blue
                })
        ));

    myDiagram.nodeTemplateMap.add("valve",
        $(go.Node, nodeStyle(),
            {
                movable: false,
                layerName: "Foreground",
                alignmentFocus: go.Spot.None
            },
            $(go.Shape, shapeStyle(),
                new go.Binding("fill", "label", function (label) {return isGhost(label) ? "#ffffff" : "#3489eb";}), // change color if ghost ($ in front of label)
                new go.Binding("figure", "label", function (label) {return isGhost(label) ? "Circle" : "Diamond";}), // change shape if ghost ($ in front of label)
                {
                    figure: "Diamond",
                    desiredSize: new go.Size(15, 15),
                    fill: "#3489eb"
                }),
            $(go.TextBlock, textStyle(),
                {
                    _isNodeLabel: true,  // declare draggable by NodeLabelDraggingTool
                    alignment: new go.Spot(0.5, 0.5, 0, 20),    // initial value
                    isMultiline: false,
                    textValidation: labelValidator, // make sure the label is unique
                },
                new go.Binding("alignment", "label_offset", go.Spot.parse).makeTwoWay(go.Spot.stringify))
        ));

    myDiagram.nodeTemplateMap.add("variable",
        $(go.Node, nodeStyle(),
            $(go.Shape, shapeStyle(),
            new go.Binding("fill", "label", function (label) {return isGhost(label) ? "#ffffff" : "#c2ffd3";}), // change color if ghost ($ in front of label)
                {
                    figure: "Ellipse",
                    desiredSize: new go.Size(25, 25)
                }),
            $(go.TextBlock, textStyle(),
                {
                    _isNodeLabel: true,  // declare draggable by NodeLabelDraggingTool
                    alignment: new go.Spot(0.5, 0.5, 0, 30),    // initial value
                    isMultiline: false,
                    textValidation: labelValidator, // make sure the label is unique
                },
                new go.Binding("alignment", "label_offset", go.Spot.parse).makeTwoWay(go.Spot.stringify))
        ));

    // Link templates
    myDiagram.linkTemplateMap.add("flow",
        $(go.Link,
            { toShortLength: 10 },
            new go.Binding("curviness", "curviness").makeTwoWay(),
            $(go.Shape,
                {
                    stroke: "#3489eb",
                    strokeWidth: 5 
                }),
            $(go.Shape,
                // add a binding to adjust if this shape is visible based on isBiflow function
                new go.Binding("visible", "", isBiflow),
                {
                    fill: "#000000",
                    stroke: "#000000",
                    fromArrow: "Backward",
                    scale: 2.0,
                }),
            $(go.Shape,
                {
                    fill: "#3489eb",
                    stroke: "#3489eb",
                    toArrow: "Standard",
                    scale: 2.0
                })
        ));

    myDiagram.linkTemplateMap.add("influence",
        $(go.Link,
            { curve: go.Link.Bezier, toShortLength: 8, reshapable: true },
            new go.Binding("curviness", "curviness").makeTwoWay(),
            $(go.Shape,
                { stroke: "#cccccc", strokeWidth: 1.5 }), // light gray
            $(go.Shape,
                {
                    fill: "#cccccc", // light gray
                    stroke: null,
                    toArrow: "Standard",
                    scale: 1.5
                })
        ));
}

// set the mode (adding stock vs adding flow vs pointer etc) based on which button is clicked
function setMode(mode, itemType) {
    myDiagram.startTransaction();
    document.getElementById(SD.itemType + "_button").className = SD.mode + "_normal";
    document.getElementById(itemType + "_button").className = mode + "_selected";
    SD.mode = mode;
    SD.itemType = itemType;
    if (mode === "pointer") {
        myDiagram.allowLink = false;
        myDiagram.nodes.each(n => n.port.cursor = "");
    } else if (mode === "node") {
        myDiagram.allowLink = false;
        myDiagram.nodes.each(n => n.port.cursor = "");
    } else if (mode === "link") {
        myDiagram.allowLink = true;
        myDiagram.nodes.each(n => n.port.cursor = "pointer");
    }
    myDiagram.commitTransaction("mode changed");
}

// populates model json with table information (not just for saving model in the end, instead gets called every time the table is updated)
function loadTableToDiagram() {
    // get the json from the GoJS model
    var data = myDiagram.model.toJson();  
    var json = JSON.parse(data);

    var $tbody = $('#eqTableBody');

    // read the equation, and checkbox values from the table
    $tbody.find('tr').each(function () {
        var name = $(this).find('input[name="name"]').val(); // get the name of the object
        var equation = $(this).find('input[name="equation"]').val(); // get the equation of the object
        var checkbox = $(this).find('input[name="checkbox"]').is(':checked'); // get the checkbox value of the object

        // update the json with the new equation and checkbox values
        $.each(json.nodeDataArray, function (i, item) {
            if (item.label === name) {
                item.equation = equation;
                item.checkbox = checkbox;
            }
        });
    }
    );

    // get current diagram.position
    var pos = myDiagram.position;

    // update the model with the new json
    myDiagram.model = go.Model.fromJson(JSON.stringify(json));

    let oldModel = sessionStorage.modelData;
    let newModel = myDiagram.model.toJson();
    sessionStorage.modelData = newModel; // updates session storage
    if (oldModel != newModel) {
        // Update the "last edited" date
        lastEditDate = new Date();
        unsavedEdits = true;
        updateSaveStatus();
    }

    // set the diagram position back to what it was
    myDiagram.initialPosition = pos;
}

// This function is used to update the equation editing table with the current model information
// load is a boolean that is true if the function is called when the model is first loaded, as then the equations and checkboxes have to be populated
function updateTable(load = false) {
    var data = myDiagram.model.toJson();
    var json = JSON.parse(data);

    // get tbody by id eqTableBody
    var $tbody = $('#eqTableBody');

    // 1. add new items to table
    $.each(json.nodeDataArray, function (i, item) { // includes stocks, variables, and clouds
        if (item.label === undefined) { // if the item is a valve or cloud, skip it
            return;
        }

        // check if the item is a ghost, if so, skip it
        if (isGhost(item.label)) {
            return;
        }

        // check if item already exists in table, if not add it
        var exists = false;
        $tbody.find('tr').each(function () {
            if ($(this).find('input[name="name"]').val() === item.label) {
                exists = true;
            }
        });

        if (!exists) {
            var category = item.category == "valve" ? "flow" : item.category; // if the item is a valve, change the category to flow

            // Create row with category-specific class
            var rowClass = "eq" + category.charAt(0).toUpperCase() + category.slice(1) + "Box";
            var $tr = $('<tr>').addClass(rowClass).append(
                $('<td>').append(
                    $('<input class="eqTableInputBox">').attr('type', 'text').attr('name', 'type').attr('value', category).attr('readonly', true).css('width', '80px') // fixed width for type column
                ),
                $('<td>').append(
                    $('<input class="eqTableInputBox">').attr('type', 'text').attr('name', 'name').attr('value', item.label).attr('readonly', true).css('width', '99%') // add the name of the object to the row (uneditable by user)
                ),
                $('<td>').append(
                    // make width 100% so that the equation takes up the entire column
                    $("<input class=\"eqTableInputBox\" style='width: inherit;'>").attr('type', 'text').attr('name', 'equation').css('width', '99%')
                ),
            ).appendTo($tbody);

            if (category === "stock" || category === "flow") {
                $('<td>').append(
                    $('<div>').attr('class', 'toggle-switch-container').append(
                        $('<label>').attr('class', 'toggle-switch').append(
                            $('<input>').attr('type', 'checkbox').attr('name', 'checkbox')
                                .change(function() {
                                    loadTableToDiagram();
                                }),
                            $('<span>').attr('class', 'toggle-slider')
                        )
                    )
                ).appendTo($tr);
            } else {
                $('<td>').appendTo($tr); // empty cell for non-stock/flow rows
            }

            // if loading from a saved model, populate the equation and checkbox values
            if (load) {
                if (item.equation !== undefined) {
                    $tr.find('input[name="equation"]').val(item.equation);
                }
                if (item.checkbox !== undefined) {
                    $tr.find('input[name="checkbox"]').prop('checked', item.checkbox);
                }
            }
        }
    });


    // 2. remove any items that are no longer in the model
    $tbody.find('tr').each(function () {
        var name = $(this).find('input[name="name"]').val(); // get the name of the object
        var exists = false;
        $.each(json.nodeDataArray, function (i, item) {
            if (item.category !== "stock" && item.category !== "variable" && item.category !== "valve") { // excludes clouds and influences
                return;
            }

            if (item.label === name) {
                exists = true;
            }
        });

        if (!exists) {
            $(this).remove();
        }
    });
}

// Add this function near the top (after imports)
function isChartAnimationEnabled() {
    const el = document.getElementById("animateChartCheckbox");
    return el && el.checked;
}
export { isChartAnimationEnabled };

// This function is used to determine if a flow is a uniflow or a biflow given the link data and the node data,
// used by GoJS binding for displaying two vs one arrow on a flow
function isBiflow(data, _) {
    // search through table to get link's checkbox value
    var $tbody = $('#eqTableBody');
    var biflow = false;

    var labelKey = data.labelKeys[0]; // get the label key of the link
    // search in nodeDataArray for the key with the same labelKey
    for (var node of myDiagram.model["nodeDataArray"]) {
        if (node.key === labelKey) {
            var flowName = node.label;
        }
    }

    if (flowName[0] === '$') { // if the flow is a ghost
        flowName = flowName.substring(1); // remove the '$' from the name
    }

    $tbody.find('tr').each(function () {
        var name = $(this).find('input[name="name"]').val(); // get the name of the object
        var checkbox = $(this).find('input[name="checkbox"]').is(':checked'); // get the checkbox value of the object

        if (name === flowName) {
            biflow = !checkbox; // if checked, that means it is a uniflow
        }
    });

    return biflow;
}

// check if the node is a ghost by checking if its label has a '$' in front of it, return color string based on that
function isGhost(label) {
    return label[0] === '$';
}

function labelValidator(textblock, oldstr, newstr) {
    if (newstr === oldstr) return true; // nothing changed

    if (newstr === "") return false; // don't allow empty label

    if (newstr[0] === "$") {
        // Only allow ghosting if the referenced node exists
        // (Previous behavior would delete the node if it didn't exist, which is bad)
        var unique = true;
        for (var i = 0; i < myDiagram.model.nodeDataArray.length; i++) {
            if (`$${myDiagram.model.nodeDataArray[i].label}` === newstr) {
                unique = false;
            }
        }
        return !unique; // we WANT a duplicate to exist
    }

    // make sure it is not **Just** a number
    if (!isNaN(newstr)) return false;

    // check all the elements in the model to make sure the new label is unique
    var unique = true;
    for (var i = 0; i < myDiagram.model.nodeDataArray.length; i++) {
        if (myDiagram.model.nodeDataArray[i].label === newstr) {
            unique = false;
        }
    }

    return unique;
}

// Displays the Simulation Error Popup
function showSimErrorPopup() {
    document.getElementById("simErrorPopup").style.display = "block";
    document.getElementById("grayEffectDiv").style.display = "block";
}
document.getElementById("simErrorPopupDismiss").addEventListener("click", closeSimErrorPopup);
// Closes the Simulation Error Popup
function closeSimErrorPopup() {
    document.getElementById("simErrorPopup").style.display = "none";
    document.getElementById("grayEffectDiv").style.display = "none";
}


function run() {
  
    loadTableToDiagram();

    var json = JSON.parse(myDiagram.model.toJson());
    var engineJson = translate(json);

    // get information on the start time, end time, dt, and integration method and add it to the engine json
    var startTime = document.getElementById("startTime").value;
    var endTime = document.getElementById("endTime").value;
    var dt = document.getElementById("dt").value;
    var integrationMethod = document.getElementById("integrationMethod").value == "euler" ? "euler" : "rk4";

    document.getElementById("startTime").classList = "simParamsInput";
    document.getElementById("endTime").classList = "simParamsInput";
    document.getElementById("dt").classList = "simParamsInput";
    //resetSimErrorPopup();

    // Error Checking part 1: All fields must be numbers
    var errors = [];
    if (isNaN(Number(startTime))) {
        errors.push("- The start time must be a number");
        document.getElementById("startTime").classList = "simParamsInput simParamsInputError";
    }
    if (isNaN(Number(endTime))) {
        errors.push("- The end time must be a number");
        document.getElementById("endTime").classList = "simParamsInput simParamsInputError";
    }
    if (isNaN(Number(dt))) {
        errors.push("- The dt must be a number");
        document.getElementById("dt").classList = "simParamsInput simParamsInputError";
    }    //Creates a set of all variables in the equation for easy access in checkValveInfluences()

    function getEquationVariables(equation) {
        // Find quoted strings first and temporarily remove them
        const quotes = [];
        const cleanEquation = equation.replace(/"[^"]*"|'[^']*'/g, match => {
            quotes.push(match.slice(1, -1)); // Remove quotes and store
            return `__QUOTE${quotes.length - 1}__`; // Replace with placeholder
        });

        // Find regular variable names
        const matches = cleanEquation.match(/[a-zA-Z_][\w\s]*/g) || [];
        
        // Restore quoted variable names and create final set
        const allMatches = [...matches, ...quotes];
        
        if (!allMatches.length) return [];
        
        // Remove math function names and Math.<fn> calls
        const mathFnSet = new Set(JAVA_MATH_FUNCTIONS);
        return [...new Set(allMatches.filter(
            v => !mathFnSet.has(v) && !v.startsWith('Math.')
        ))];
    }

    //Checks to see if objects referenced in a certain equation have the necessary influences in the diagram
    function checkValveInfluences(){
        const valveNodes = myDiagram.model.nodeDataArray.filter(node => node.category === "valve");
        const issues = [];

        for(const valve of valveNodes){
            const equation = valve.equation || "";
            const usedVars = getEquationVariables(equation);

            const incomingInfluences = myDiagram.model.linkDataArray.filter(link => link.category === "influence" && link.to == valve.key).map(link => myDiagram.model.findNodeDataForKey(link.from)?.label);
            const missingInfluences = usedVars.filter(varName => !incomingInfluences.includes(varName));
            if (missingInfluences.length > 0){
                issues.push({
                    valve: valve.label,
                    missingVars: missingInfluences
                });
            }
        }
        return issues;
    }

    const issues = checkValveInfluences();
    if (issues.length > 0) {
        errors.push("Missing influences detected! Please add the following influences: ");
        issues.forEach(issue => {
        errors.push(`➨ Object ${issue.valve} is missing influences for: ${issue.missingVars.join(", ")}`);
    });
    }

    if (errors.length != 0) {
        // window.scroll({
        //     top: document.body.scrollHeight,
        //     behavior: "smooth",
        // });
        document.getElementById("simErrorPopupDesc").innerHTML = "Please fix the following errors: <br><br>" + errors.join("<br>");
        showSimErrorPopup();
        return;
    }

    // Error Checking part 2: Other issues
    if(Number(startTime) >= Number(endTime)){ // terminates if the end time is not greater than the start
      errors.push("- The end time must be greater than the start time");
      document.getElementById("endTime").classList = "simParamsInput simParamsInputError";
    }

    if(Number(dt) > Number(endTime)-Number(startTime)){ // terminates if the dt is greater than duration
      errors.push("- The dt must be less than or equal to the duration.");
      document.getElementById("dt").classList = "simParamsInput simParamsInputError";
    }

    if(Number(dt) <= 0){ // terminates if the dt is not greater than zero
      errors.push("- The dt must be positive");
      document.getElementById("dt").classList = "simParamsInput simParamsInputError";
    }
    if (errors.length != 0) {
        // window.scroll({
        //     top: document.body.scrollHeight,
        //     behavior: "smooth",
        // });
        document.getElementById("simErrorPopupDesc").innerHTML = "There are errors with the simulation parameters:<br><br>" + errors.join("<br>");
        showSimErrorPopup();
        return;
    }

    // Error Checking part 3: High Step-Count Checker (avoids freezing)
    if((Number(endTime) - Number(startTime)) / Number(dt) >= 1000){ // 1000+ Steps
        if (!document.getElementById("simParamHighStepCount").checked) {
            document.getElementById("dt").classList = "simParamsInput simParamsInputWarning";
            // window.scroll({
            //     top: document.body.scrollHeight,
            //     behavior: "smooth",
            // });
            document.getElementById("simErrorPopupDesc").innerHTML = "This simulation contains 1000+ steps; as such, running it may lead to lag or the website freezing. Please adjust dt or enable high step-count simulations.<br><br>If you proceed with the simulation, it may be wise to export your LunaSim project in case the website crashes.";
            showSimErrorPopup();
            return;
        }       
    }

    // Looks all good!
    engineJson.start_time = parseFloat(startTime);
    engineJson.end_time = parseFloat(endTime);
    engineJson.dt = parseFloat(dt);
    engineJson.integration_method = integrationMethod;
    
    sim.setData(engineJson);

    if (PERFORMANCE_MODE == true)
      console.time('Simulation Runtime'); // Measuring simulation runtime

    data = sim.run();

    if (PERFORMANCE_MODE == true) { // Measuring simulation runtime
      console.timeEnd('Simulation Runtime');
    }

    console.log(data);
  
    sim.reset();

    // Hopefully, the simulation should have successfully completed; scroll to top of page
    // and open the "Charts/Tables" tab
    window.scroll({
        top: 0,
        behavior: "smooth",
    });
    document.getElementById("secondaryOpen").click();
}

// function to change color of the tool button when selected (does through changing the class)
function toolSelect(evt) {
  var i, tabcontent, tablinks;
  tablinks = document.getElementsByClassName("tool");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }
  evt.currentTarget.className += " active";
}

// function to change tab view (does through changing the display)
function opentab(evt, tabName) {
  var i, tabcontent, tablinks;
  tabcontent = document.getElementsByClassName("tabContent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }
  document.getElementById(tabName).style.display = "block";
  evt.currentTarget.className += " active";
}

function exportData() {
    var filename = document.getElementById("model_name").value;
    loadTableToDiagram();
    var json = JSON.parse(myDiagram.model.toJson());

    // add simulation parameters to the json
    json.simulationParameters = {
        "startTime": parseFloat(document.getElementById("startTime").value),
        "endTime": parseFloat(document.getElementById("endTime").value),
        "dt": parseFloat(document.getElementById("dt").value),
        "integrationMethod": document.getElementById("integrationMethod").value == "euler" ? "euler" : "rk4"
    };

    // download it 
    download(`${filename}.luna`, JSON.stringify(json));

    // update export date
    lastExportDate = new Date();
    hasExportedYet = true;
    unsavedEdits = false; // Once exported, no more unsaved edits
    updateSaveStatus();
}

function download(filename, text) {
    var pom = document.createElement('a');
    pom.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    pom.setAttribute('download', filename);

    if (document.createEvent) {
        var event = document.createEvent('MouseEvents');
        event.initEvent('click', true, true);
        pom.dispatchEvent(event);
    }
    else {
        pom.click();
    }
}

function loadModel(evt) {
    var reader = new FileReader();

    reader.onload = function (evt) {
        // Check if the file is valid JSON       
        var json;
        try {
            json = JSON.parse(evt.target.result);
        } catch (e) {
            alert(`Something went wrong while parsing this file! Most likely, the file you uploaded isn't a valid LunaSim model.\n\nDetailed Error Log:\n${e.message}`);
            return;
        }

        // Check for blank model loading
        if (go.Model.fromJson(evt.target.result).Pc.length == 0) {
            // .Pc is where the list of "objects" in the model is stored
            // Checked via console.log testing
            // This *probably* isn't good standard but it seems to be consistent across platforms & models
            
            let confirmBlankLoad = confirm("This model appears to be blank! Are you sure you want to load it?");
            if (!confirmBlankLoad) return;
        }

        // If we get here, everything should be good

        // check if the json has simulation parameters
        if (json.simulationParameters) {
            // add simulation parameters from the json
            document.getElementById("startTime").value = json.simulationParameters.startTime;
            document.getElementById("endTime").value = json.simulationParameters.endTime;
            document.getElementById("dt").value = json.simulationParameters.dt;
            document.getElementById("integrationMethod").value = json.simulationParameters.integrationMethod;
        } else {
            document.getElementById("startTime").value = 0;
            document.getElementById("endTime").value = 10;
            document.getElementById("dt").value = 0.1;
            document.getElementById("integrationMethod").value = "rk4";
        }        

        // clear the diagram
        myDiagram.model = go.Model.fromJson("{ \"class\": \"GraphLinksModel\", \"linkLabelKeysProperty\": \"labelKeys\", \"nodeDataArray\": [],\"linkDataArray\": [] }");
        // clear the table
        $('#eqTableBody').empty();
        
        // Load the new model
        myDiagram.model = go.Model.fromJson(evt.target.result);
       
        updateTable(true);
        loadTableToDiagram();

        // set the diagram position back to what it was
        myDiagram.initialPosition = myDiagram.position;

        // Reset save status after loading model
        lastEditDate = new Date();
        unsavedEdits = false;
        lastExportDate = new Date();
        hasExportedYet = false;
        updateSaveStatus();
    }

    /*
    // This doesn't actually appear to be firing on an error, so I commented it out and wrote my own error handler.
    // Add back in if I didn't read the documentation properly and it actually works.
    
    reader.addEventListener("error", function (evt) {
        alert("error reading file");
    });*/

    reader.readAsText(evt.target.files[0]);
}

// Themes
function setTheme(themeName) {
    const themes = ['light', 'dark', 'classic', 'forest'];
    const themeCSS = {
        light: document.getElementById("lightThemeCSS"),
        dark: document.getElementById("darkThemeCSS"),
        classic: document.getElementById("classicThemeCSS"),
        forest: document.getElementById("forestThemeCSS")
    };
    
    // Validate theme name
    if (!themes.includes(themeName)) {
        themeName = 'light'; // fallback to default
    }
    
    // Disable all themes
    Object.values(themeCSS).forEach(css => {
        if (css) css.disabled = true;
    });
    
    // Enable the specified theme
    if (themeCSS[themeName]) {
        themeCSS[themeName].disabled = false;
    }
    
    // Update sessionStorage
    sessionStorage.setItem("currentTheme", themeName);
    
    // Keep legacy darkMode for backward compatibility
    sessionStorage.setItem("darkMode", themeName === 'dark');
}

function switch_theme(orig) {
    const themes = ['light', 'dark', 'classic', 'forest'];
    
    // Get current theme from sessionStorage, default to 'light'
    let currentTheme = sessionStorage.getItem("currentTheme") || 'light';
    
    // Find next theme in cycle
    let currentIndex = themes.indexOf(currentTheme);
    let nextIndex = (currentIndex + 1) % themes.length;
    let nextTheme = themes[nextIndex];
    
    // Use setTheme to apply the new theme
    setTheme(nextTheme);

    // Removed annoying popup notification when switching themes
    // if (!orig) {
    //     var popupNotif = document.getElementById("popupNotif");
    //     var popupNotifText = document.getElementById("popupNotifText");
    //     popupNotifText.innerHTML = `Switched to ${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)} theme - Refresh to apply all changes`;
    //     popupNotif.style.visibility = "visible";
    // }
}

document.getElementById("switch_button").addEventListener("click", function() { switch_theme(false) });
document.getElementById("popupNotifClose").addEventListener("click", function() {
    popupNotif.style.visibility = "hidden";
});

// Retrieves session storage data when loaded
window.onload = function(){  if(sessionStorage.modelData){
    myDiagram.model = go.Model.fromJson(sessionStorage.modelData);
    updateTable(true);
    loadTableToDiagram();
  }
    // Initialize theme on page load
  let savedTheme = sessionStorage.getItem("currentTheme");
  if (savedTheme) {
    // Directly set the saved theme
    setTheme(savedTheme);
  } else if (sessionStorage.getItem("darkMode") == "true") {
    // Legacy support for old darkMode setting
    setTheme('dark');
  } else {
    // Default to light theme
    setTheme('light');
  }
}

// Model Loading
document.getElementById("loadButton").addEventListener("click", function () {
    if (unsavedEdits) {
        // Add a warning if the user has changed the model since their last export
        let confirmLoad = confirm(`You've made changes to this model since the last time you exported it (if at all). If you load a new model now without exporting, your changes will be lost! Are you sure you want to proceed?\n\n(Press CANCEL to go back and export your model.)`);
        if (!confirmLoad) return;
    }

    document.getElementById("load-actual-button").click();
});

init();


document.addEventListener("keydown", function(e){
    const target = e.target;
    const tag = target.tagName.toLowerCase();
    
    // Block if target is any kind of text input
    if (tag === "input" || tag === "textarea" || target.isContentEditable) {
        return;
    }

    // Block if editing a GoJS label
    if (target.classList && (
        target.classList.contains('go-text-editor') ||  // In-place editor input element
        target.classList.contains('go-editor') ||       // Editor container
        target.closest('.go-text-editor') ||           // Inside editor input
        target.closest('.go-editor')                   // Inside editor container
    )) {
        return;
    }

    // Block if diagram is in a transaction (like editing text)
    if (myDiagram && myDiagram.isModifying) {
        return;
    }

    // Map keys to button IDs
    const keyMap = {
        p: "pointer_button",
        s: "stock_button", 
        v: "variable_button",
        c: "cloud_button",
        i: "influence_button",
        f: "flow_button",
        d: "drag_button"
    };

    const key = e.key.toLowerCase();
    const buttonId = keyMap[key];
    if (buttonId) {
        document.getElementById(buttonId).click();
    }
});

// add button event listeners
// mode buttons
document.getElementById("pointer_button").addEventListener("click", function() { setMode("pointer", "pointer"); toolSelect(event); });
document.getElementById("stock_button").addEventListener("click", function() { setMode("node", "stock"); toolSelect(event); });
document.getElementById("cloud_button").addEventListener("click", function() { setMode("node", "cloud"); toolSelect(event); });
document.getElementById("variable_button").addEventListener("click", function() { setMode("node", "variable"); toolSelect(event); });
document.getElementById("flow_button").addEventListener("click", function() { setMode("link", "flow"); toolSelect(event); });
document.getElementById("influence_button").addEventListener("click", function() { setMode("link", "influence"); toolSelect(event); });

// add button event listeners for utility functions
document.getElementById("drag_button").addEventListener("click", function() { 
    setMode("pointer", "pointer");
    myDiagram.toolManager.panningTool.isEnabled = false;
    myDiagram.toolManager.dragSelectingTool.isEnabled = true;
    myDiagram.currentTool = myDiagram.toolManager.dragSelectingTool;
    toolSelect(event);
});

document.getElementById("undo_button").addEventListener("click", function() {
    if (myDiagram.commandHandler.canUndo()) {
        myDiagram.commandHandler.undo();
    }
});

document.getElementById("redo_button").addEventListener("click", function() {
    if (myDiagram.commandHandler.canRedo()) {
        myDiagram.commandHandler.redo();
    }
});

document.getElementById("center_button").addEventListener("click", function() {
    // Use zoomToFit to fit all parts, then center the viewport on the diagram bounds
    myDiagram.scale = 1.0;
    myDiagram.zoomToFit();
    // Center the viewport on the diagram bounds
    const bounds = myDiagram.documentBounds;
    const view = myDiagram.viewportBounds;
    if (!bounds.isEmpty()) {
        // Calculate the center point of the diagram bounds
        const center = bounds.center;
        // Set position so that the center of the diagram is at the center of the viewport
        myDiagram.position = new go.Point(center.x - view.width / 2, center.y - view.height / 2);
    }
});

// Return to normal mode after using drag tool
document.addEventListener("mouseup", function() {
    if (SD.itemType === "pointer" && myDiagram.toolManager.dragSelectingTool.isEnabled) {
        myDiagram.toolManager.dragSelectingTool.isEnabled = false;
        myDiagram.toolManager.panningTool.isEnabled = true;
        document.getElementById("pointer_button").click();
    }
});


// Set initial mode as pointer (for UI shading)
document.getElementById("pointer_button").click();

// tab buttons
document.getElementById("defaultOpen").addEventListener("click", function() { opentab(event, "modalView"); });
document.getElementById("secondaryOpen").addEventListener("click", function() { opentab(event, "chartsTables"); });
// Open modal viewer
document.getElementById("defaultOpen").click();

// save, load, and run buttons

document.getElementById("load-actual-button").addEventListener("change", loadModel);
document.getElementById("runButton").addEventListener("click", function() { run(); });
document.getElementById("exportButton").addEventListener("click", function() { exportData(); });

// Add image export functionality
document.getElementById("image_button").addEventListener("click", function() {
    // First center and fit diagram
    myDiagram.scale = 1.0;
    myDiagram.commandHandler.scrollToPart(myDiagram.findNodeForKey(myDiagram.model.nodeDataArray[0]?.key));
    myDiagram.commandHandler.zoomToFit();
    
    // Add small delay to allow diagram to finish centering
    setTimeout(function() {
        // Create a canvas and get diagram as image
        const img = myDiagram.makeImageData({
            background: "white",
            scale: 1.0,
            maxSize: new go.Size(9999, 9999)
        });

        // Create temporary link element to trigger download
        const link = document.createElement('a');
        link.download = `${document.getElementById("model_name").value || 'diagram'}.png`;
        link.href = img;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, 100); // 100ms delay
});

// clear button
document.getElementById("clearButton").addEventListener("click", function() {
    let confirmNewModel = confirm("Clear this model and start a new one? Your current project will be wiped!");
    if (confirmNewModel) {
        let doubleConfirm = confirm("Are you sure? If you want to save the project you are currently working on, press 'Cancel' and export it first; otherwise, the data will be cleared. You've been warned!");
        if (!doubleConfirm) return;
        
        // Reset Model
        document.getElementById("startTime").value = 0;
        document.getElementById("endTime").value = 10;
        document.getElementById("dt").value = 0.1;
        document.getElementById("integrationMethod").value = "rk4";

        // clear the diagram
        myDiagram.model = go.Model.fromJson("{ \"class\": \"GraphLinksModel\", \"linkLabelKeysProperty\": \"labelKeys\", \"nodeDataArray\": [],\"linkDataArray\": [] }");
        // clear the table
        $('#eqTableBody').empty();

        // Reset save status after clearing model
        lastEditDate = new Date();
        unsavedEdits = false;
        lastExportDate = new Date();
        hasExportedYet = false;
        updateSaveStatus();
    } 
});

// reload/close warning
// TEST-UI-001-004
window.addEventListener('beforeunload', function (e) {
    if (unsavedEdits) e.preventDefault();
});

// Exporting myDiagram
export {data};

// --- Math Function Autocomplete for Equation Editor ---
const MATH_CONSTANTS = {
    '|': '||'  // For absolute value
};

const JAVA_MATH_FUNCTIONS = [
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
    'exp', 'log', 'log10', 'sqrt', 'cbrt', 'abs', 'ceil', 'floor', 'round', 'pow', 'max', 'min', 'signum', 'toRadians', 'toDegrees', 'random', 'hypot', 'expm1', 'log1p', 'copySign', 'nextUp', 'nextDown', 'ulp', 'IEEEremainder', 'rint', 'getExponent', 'scalb', 'fma'
];

// Create autocomplete dropdown
function createMathAutocomplete() {
    let dropdown = document.createElement('div');
    dropdown.id = 'math-autocomplete';
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = 100000000;
    dropdown.style.background = '#fff';
    dropdown.style.border = '1px solid #a77aff';
    dropdown.style.display = 'none';
    dropdown.style.maxHeight = '200px';
    dropdown.style.overflowY = 'auto';
    dropdown.style.fontSize = '14px';
    dropdown.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    document.body.appendChild(dropdown);
    return dropdown;
}

const mathAutocomplete = createMathAutocomplete();
let mathAutocompleteSelectedIndex = -1;
let mathAutocompleteMatches = [];
let mathAutocompleteInputElem = null;

function showMathAutocomplete(inputElem, word) {
    if (!word) {
        mathAutocomplete.style.display = 'none';
        mathAutocompleteSelectedIndex = -1;
        mathAutocompleteMatches = [];
        mathAutocompleteInputElem = null;
        return;
    }
    const rect = inputElem.getBoundingClientRect();
    mathAutocomplete.style.left = rect.left + window.scrollX + 'px';
    mathAutocomplete.style.top = rect.bottom + window.scrollY + 'px';
    mathAutocomplete.innerHTML = '';
    
    // Check for constants first
    const constantMatches = Object.keys(MATH_CONSTANTS).filter(k => k.startsWith(word.toLowerCase()));
    
    // Then check functions
    let matches = JAVA_MATH_FUNCTIONS.filter(fn => fn.startsWith(word));
    
    // Combine both types of matches
    matches = [...constantMatches, ...matches];
    mathAutocompleteMatches = matches;
    mathAutocompleteInputElem = inputElem;
    mathAutocompleteSelectedIndex = -1;
    if (matches.length === 0) {
        mathAutocomplete.style.display = 'none';
        return;
    }
    matches.forEach((fn, idx) => {
        let item = document.createElement('div');
        item.textContent = fn + '(...)';
        item.style.padding = '4px 8px';
        item.style.cursor = 'pointer';
        item.dataset.index = idx;
        item.addEventListener('mousedown', function(e) {
            e.preventDefault();
            insertMathFunction(inputElem, fn);
            mathAutocomplete.style.display = 'none';
        });
        mathAutocomplete.appendChild(item);
    });
    mathAutocomplete.style.display = 'block';
    highlightMathAutocomplete();
}

function highlightMathAutocomplete() {
    const children = mathAutocomplete.children;
    for (let i = 0; i < children.length; i++) {
        if (i === mathAutocompleteSelectedIndex) {
            children[i].style.background = '#e0e0e0';
        } else {
            children[i].style.background = '#fff';
        }
    }
}

function insertMathFunction(inputElem, fn) {
    let start = inputElem.selectionStart;
    let end = inputElem.selectionEnd;
    let value = inputElem.value;
    // Find the word before the cursor
    let before = value.slice(0, start).replace(/.*?([a-zA-Z0-9_]*)$/, '$1');
    let wordStart = start - before.length;
    
    // Check if it's a constant or special symbol
    if (MATH_CONSTANTS.hasOwnProperty(fn.toLowerCase())) {
        const replacement = MATH_CONSTANTS[fn.toLowerCase()];
        if (fn === '|') {
            // For absolute value, put the cursor between the pipes
            inputElem.value = value.slice(0, wordStart) + '|' + value.slice(end) + '|';
            inputElem.selectionStart = inputElem.selectionEnd = wordStart + 1;
        } else {
            // For constants (pi, e), just insert them
            inputElem.value = value.slice(0, wordStart) + replacement + value.slice(end);
            inputElem.selectionStart = inputElem.selectionEnd = wordStart + replacement.length;
        }
    } else {
        // For regular functions, add parentheses
        inputElem.value = value.slice(0, wordStart) + fn + '()' + value.slice(end);
        inputElem.selectionStart = inputElem.selectionEnd = wordStart + fn.length + 1;
    }
    inputElem.focus();
}

//Adds autocomplete/hinting for supported math functions in Java in the equation editor
function attachMathAutocomplete() {
    document.addEventListener('input', function(e) {
        if (e.target && e.target.tagName === 'INPUT' && e.target.closest('#eqTableBody')) {
            let inputElem = e.target;
            let pos = inputElem.selectionStart;
            let value = inputElem.value.slice(0, pos);

            let openBrackets = (value.match(/\[/g) || []).length;
            let closeBrackets = (value.match(/\]/g) || []).length;
            if (openBrackets > closeBrackets) {
                mathAutocomplete.style.display = 'none';
                mathAutocompleteSelectedIndex = -1;
                mathAutocompleteMatches = [];
                mathAutocompleteInputElem = null;
                return;
            }
            
            let match = value.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
            if (match) {
                showMathAutocomplete(inputElem, match[1]);
            } else {
                mathAutocomplete.style.display = 'none';
                mathAutocompleteSelectedIndex = -1;
                mathAutocompleteMatches = [];
                mathAutocompleteInputElem = null;
            }
        }
    });
    document.addEventListener('click', function(e) {
        if (!mathAutocomplete.contains(e.target)) {
            mathAutocomplete.style.display = 'none';
            mathAutocompleteSelectedIndex = -1;
            mathAutocompleteMatches = [];
            mathAutocompleteInputElem = null;
        }
    });
    document.addEventListener('keydown', function(e) {
        if (mathAutocomplete.style.display === 'block' && mathAutocompleteMatches.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                mathAutocompleteSelectedIndex = (mathAutocompleteSelectedIndex + 1) % mathAutocompleteMatches.length;
                highlightMathAutocomplete();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                mathAutocompleteSelectedIndex = (mathAutocompleteSelectedIndex - 1 + mathAutocompleteMatches.length) % mathAutocompleteMatches.length;
                highlightMathAutocomplete();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (mathAutocompleteSelectedIndex >= 0 && mathAutocompleteInputElem) {
                    e.preventDefault();
                    insertMathFunction(mathAutocompleteInputElem, mathAutocompleteMatches[mathAutocompleteSelectedIndex]);
                    mathAutocomplete.style.display = 'none';
                    mathAutocompleteSelectedIndex = -1;
                    mathAutocompleteMatches = [];
                    mathAutocompleteInputElem = null;
                }
            } else if (e.key === 'Escape') {
                mathAutocomplete.style.display = 'none';
                mathAutocompleteSelectedIndex = -1;
                mathAutocompleteMatches = [];
                mathAutocompleteInputElem = null;
            }
        }
    });
}

attachMathAutocomplete();

// Equation Editor Popup functionality
document.getElementById('expandEqEditor').addEventListener('click', function() {
  const popup = document.getElementById('expandedEqEditorPopup');
  const overlay = document.getElementById('grayEffectDiv');
  const originalTable = document.getElementById('eqTable');
  const expandedTableDiv = document.getElementById('expandedEqTableDiv');
  
  // Clone the table
  const tableClone = originalTable.cloneNode(true);
  tableClone.id = 'expandedEqTable';
  
  // Clear previous content and add the clone
  expandedTableDiv.innerHTML = '';
  expandedTableDiv.appendChild(tableClone);
  
  // Show popup and overlay
  popup.style.display = 'block';
  overlay.style.display = 'block';
  
  // Sync changes from expanded table back to original
  tableClone.addEventListener('input', function(e) {
    if (e.target.tagName === 'INPUT') {
      // Find the row in the popup table
      const popupRow = e.target.closest('tr');
      if (!popupRow) return;
      // Get the unique name for this row
      const nameInput = popupRow.querySelector('input[name="name"]');
      if (!nameInput) return;
      const uniqueName = nameInput.value;

      // Find the matching row in the original table by name
      const originalRows = originalTable.querySelectorAll('tbody tr');
      for (const row of originalRows) {
        const origNameInput = row.querySelector('input[name="name"]');
        if (origNameInput && origNameInput.value === uniqueName) {
          // Now find the matching input by type (equation, checkbox, etc)
          const origInput = row.querySelector(`input[name="${e.target.name}"]`);
          if (origInput) {
            if (e.target.type === 'checkbox') {
              origInput.checked = e.target.checked;
            } else {
              origInput.value = e.target.value;
            }
            // Trigger change event
            const event = new Event('change', { bubbles: true });
            origInput.dispatchEvent(event);
          }
          break;
        }
      }
    }
  });

  // Sync checkbox changes
  tableClone.addEventListener('change', function(e) {
    if (e.target.type === 'checkbox') {
      const popupRow = e.target.closest('tr');
      if (!popupRow) return;
      const nameInput = popupRow.querySelector('input[name="name"]');
      if (!nameInput) return;
      const uniqueName = nameInput.value;
      const originalRows = originalTable.querySelectorAll('tbody tr');
      for (const row of originalRows) {
        const origNameInput = row.querySelector('input[name="name"]');
        if (origNameInput && origNameInput.value === uniqueName) {
          const origCheckbox = row.querySelector(`input[type="checkbox"][name="${e.target.name}"]`);
          if (origCheckbox) {
            origCheckbox.checked = e.target.checked;
            // Trigger change event
            const event = new Event('change', { bubbles: true });
            origCheckbox.dispatchEvent(event);
          }
          break;
        }
      }
    }
  });
});

document.getElementById('closeExpandedEqEditor').addEventListener('click', function() {
  const popup = document.getElementById('expandedEqEditorPopup');
  const overlay = document.getElementById('grayEffectDiv');
  
  popup.style.display = 'none';
  overlay.style.display = 'none';
});

