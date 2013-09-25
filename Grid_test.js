goog.provide('com.qwirx.grid.Grid_test');

goog.require('com.qwirx.grid.Grid');
goog.require('com.qwirx.grid.NavigableGrid');
goog.require('com.qwirx.data.SimpleDatasource');
goog.require('com.qwirx.test.FakeBrowserEvent');
goog.require('com.qwirx.test.FakeClickEvent');
goog.require('com.qwirx.test.assertThrows');
goog.require('com.qwirx.test.findDifferences');

goog.require('goog.dom.NodeIterator');
goog.require('goog.testing.jsunit');
goog.require('goog.testing.MockControl');

var domContainer = goog.dom.createDom(goog.dom.TagName.DIV,
	{'style': 'background-color: #eee; width: 50%; height: 400px; ' +
	'float: right;'});
goog.dom.appendChild(document.body, domContainer);

var mockController, columns, data, ds, dialog_response;
var stubs = new goog.testing.PropertyReplacer();

function setUp()
{
	com.qwirx.ui.Dialog.isTestMode = true;
	
	// goog.style.setHeight(domContainer, 300);
	domContainer.style.height = '300px';
	domContainer.style.overflow = 'hidden';
	goog.dom.removeChildren(domContainer);
	
	columns = [
		{name: 'product', caption: 'Product'},
		{name: 'strength', caption: 'Special Ability'},
		{name: 'weakness', caption: 'Hidden Weakness'}
	];
	data = [
		{product: 'milk', strength: 'Reduces bitterness, especially in adults',
			weakness: 'Goes bad quickly, not vegan compatible'},
		{product: 'rye bread', strength: 'Can be used to make boxes',
			weakness: 'Tastes like cardboard'},
		{product: 'nuts', strength: 'Full of essential oils',
			weakness: 'Expensive'},
		{product: 'soymilk', strength: 'Long life, vegan compatible',
			weakness: 'Tastes like cardboard'},
	];
	ds = new com.qwirx.data.SimpleDatasource(columns, data);
	
	mockController = new goog.testing.MockControl();
}

function expect_dialog(callback, response_button, listener)
{
	assertUndefined("The previous dialog response has not been used: " +
		com.qwirx.ui.Dialog.dialogResponse,
		com.qwirx.ui.Dialog.dialogResponse);
	com.qwirx.ui.Dialog.dialogResponse = response_button;
	callback.call(listener);
	assertUndefined("Dialog should have been displayed, and " +
		"com.qwirx.ui.Dialog.dialogResponse cleared",
		com.qwirx.ui.Dialog.dialogResponse);
}

function tearDown()
{
	com.qwirx.ui.Dialog.isTestMode = false;
	mockController.$tearDown();
	stubs.reset();
}

function test_NavigableGrid_createDom()
{
	var grid = new com.qwirx.grid.NavigableGrid(ds);
	grid.createDom();
	
	// grid container and scrolling container should fill the
	// available space
	var elem = grid.getElement();
	assertEquals("Grid should fill 100% of parent element",
		"100%", elem.style.height);
	assertEquals("Grid should fill 100% of parent element",
		"100%", elem.style.width);
	
	assertEquals("BorderLayout should have a CSS class", 
		"com_qwirx_ui_BorderLayout", grid.layout_.getElement().className);
}

function initGrid(datasource)
{
	var navgrid = new com.qwirx.grid.NavigableGrid(datasource);
	navgrid.render(domContainer);
	
	var grid = navgrid;

	// grid should initially display the top left corner
	assertObjectEquals({x: 0, y: 0}, grid.scrollOffset_);
	
	// grid container and scrolling container should fill the
	// available space
	var elem = navgrid.getElement();
	assertEquals("Grid should fill 100% of parent element",
		"100%", elem.style.height);
	
	// data div height + nav bar height should equal total height
	var navgrid_elem = navgrid.getElement();
	var nav_elem = navgrid.nav_.getElement();
	var data_elem = grid.wrapper.getElement();
	assertEquals(navgrid_elem.offsetHeight /* includes borders */,
		data_elem.offsetHeight + nav_elem.offsetHeight);
	
	// grid should not have any rows outside the visible area
	// of the data div
	var rows = grid.dataTable_.children[0].children;
	var lastRow = rows[rows.length - 1];
	var container = grid.wrapper.getElement();
	var containerPos = goog.style.getPageOffset(container);
	var lastRowPos = goog.style.getPageOffset(lastRow);
	var remainingSpace = (containerPos.y + container.clientHeight) -
		(lastRowPos.y + lastRow.clientHeight);
	assertTrue(remainingSpace > 0);
	
	// a click which doesn't change the row selection should not
	// cause an error
	assertSelection(grid, "initial state should be no selection",
		-1, -1, -1, -1);
	
	return navgrid;
}

function assertSelection(grid, message, x1, y1, x2, y2)
{
	// shortcut to avoid comparing origin, which is a DOM node that
	// leads to really deep comparisons!
	var expected = {x1: x1, y1: y1, x2: x2, y2: y2};
	var actual = goog.object.clone(grid.drag);
	goog.object.remove(actual, 'origin');
	assertObjectEquals(message, expected, actual);
	var scroll = grid.scrollOffset_;
	
	// check that row and column CSS classes match expectations
	for (var y = 0; y < grid.getVisibleRowCount(); y++)
	{
		var rowElement = grid.rows_[y].getRowElement();
		var dataRow = y + scroll.y;
		var shouldBeVisible = (dataRow < grid.dataSource_.getCount());
		
		assertEquals(message + ": wrong visible status for " +
			"grid row " + y + ", data row " + dataRow,
			shouldBeVisible ? "" : "hidden", rowElement.style.visibility);
		
		if (shouldBeVisible)
		{
			assertEquals(message + ": wrong highlight status for " +
				"grid row " + y + ", data row " + dataRow,
				/* should this row be highlighted? */
				dataRow >= Math.min(y1, y2) &&
				dataRow <= Math.max(y1, y2),
				/* is it actually highlighted? */
				goog.dom.classes.has(rowElement, 'highlight'));
		}		
	}

	var builder = new goog.string.StringBuffer();
	for (var x = Math.min(x1, x2); x <= Math.max(x1, x2) && x1 >= 0; x++)
	{
		builder.append('table#' + grid.dataTable_.id + ' > ' +
			'tr.highlight > td.col_' + x + ' { background: #ddf; }');
	}
	assertEquals(message, builder.toString(), grid.highlightStyles_.innerHTML);
}

function testGridHighlightModeCells()
{
	var grid = initGrid(ds);
	
	com.qwirx.test.FakeBrowserEvent.mouseMove(grid.getCell(0, 0).tableCell);
	assertSelection(grid, 'Selection should not have changed without click',
		-1, -1, -1, -1);

	com.qwirx.test.FakeBrowserEvent.mouseDown(grid.getCell(0, 0).tableCell);
	assertSelection(grid, 'Selection should have changed with click',
		0, 0, 0, 0);
	assertEquals(com.qwirx.grid.Grid.DragMode.TEXT, grid.dragMode_);
	assertEquals(true, grid.isAllowTextSelection());
	assertEquals("mousedown should have set current row", 0,
		grid.getCursor().getPosition());
		
	// MOUSEOUT on a different cell is spurious and doesn't change mode
	com.qwirx.test.FakeBrowserEvent.mouseOut(grid.getCell(1, 0).tableCell);
	assertEquals(com.qwirx.grid.Grid.DragMode.TEXT, grid.dragMode_);
	assertEquals(true, grid.isAllowTextSelection());
	
	com.qwirx.test.FakeBrowserEvent.mouseOut(grid.getCell(0, 1).tableCell);
	assertEquals(com.qwirx.grid.Grid.DragMode.TEXT, grid.dragMode_);
	assertEquals(true, grid.isAllowTextSelection());
	var cell = grid.getCell(0, 0).tableCell;
	assertEquals("Original cell should still be editable",
		"true", cell.contentEditable);
	var userSelect = goog.style.getComputedStyle(cell, 'webkitUserSelect');
	assertEquals("If webkitUserSelect is 'none' then controls in the " +
		"BorderLayout won't be usable/editable", "text", userSelect);

	// simulate MOUSEOUT to change the drag mode from TEXT to CELLS
	// this is the original starting cell, and leaving it does change mode
	com.qwirx.test.FakeBrowserEvent.mouseOut(grid.getCell(0, 0).tableCell);
	assertEquals(com.qwirx.grid.Grid.DragMode.CELLS, grid.dragMode_);
	assertEquals(false, grid.isAllowTextSelection());
	assertEquals("Original cell should no longer be editable",
		"inherit", grid.getCell(0, 0).tableCell.contentEditable);

	// entry into another cell has no effect
	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(1, 1).tableCell);
	assertEquals(com.qwirx.grid.Grid.DragMode.CELLS, grid.dragMode_);
	assertEquals(false, grid.isAllowTextSelection());
	
	// re-entry into starting cell switches mode back to TEXT
	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(0, 0).tableCell);
	assertEquals(com.qwirx.grid.Grid.DragMode.TEXT, grid.dragMode_);
	assertEquals(true, grid.isAllowTextSelection());
	assertEquals("Original cell should be editable again",
		"true", grid.getCell(0, 0).tableCell.contentEditable);

	// re-exit from starting cell switches mode back to CELLS
	com.qwirx.test.FakeBrowserEvent.mouseOut(grid.getCell(0, 0).tableCell);
	assertEquals(com.qwirx.grid.Grid.DragMode.CELLS, grid.dragMode_);
	assertEquals(false, grid.isAllowTextSelection());
	assertEquals("Original cell should no longer be editable",
		"inherit", grid.getCell(0, 0).tableCell.contentEditable);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(0, 1).tableCell);
	assertSelection(grid, 'Selection should have changed with drag',
		0, 0, 0, 1);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(1, 0).tableCell);
	assertSelection(grid, 'Selection should have changed with drag',
		0, 0, 1, 0);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(0, 0).tableCell);
	assertSelection(grid, 'Selection should have changed with reentry to ' +
		'starting cell', 0, 0, 0, 0);

	// that will have switched the mode back to TEXT, and only
	// a mouseout will change it back
	assertEquals(com.qwirx.grid.Grid.DragMode.TEXT, grid.dragMode_);
	com.qwirx.test.FakeBrowserEvent.mouseOut(grid.getCell(0, 0).tableCell);
	assertEquals(com.qwirx.grid.Grid.DragMode.CELLS, grid.dragMode_);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(1, 1).tableCell);
	assertSelection(grid, 'Selection should have changed with drag',
		0, 0, 1, 1);

	// mouseup should enable text selection, even if it wasn't
	// enabled before, to allow keyboard selection afterwards
	assertEquals(com.qwirx.grid.Grid.DragMode.CELLS, grid.dragMode_);
	assertEquals(false, grid.isAllowTextSelection());
	com.qwirx.test.FakeBrowserEvent.mouseUp(grid.getCell(0, 0).tableCell);
	assertEquals(true, grid.isAllowTextSelection());
	// and set the selection mode back to NONE, so that future
	// mouse movement events don't cause selection changes
	assertEquals(com.qwirx.grid.Grid.DragMode.NONE, grid.dragMode_);
	// selection changes with mouseover, not mouseup
	assertSelection(grid, 'Selection should not have changed with mouseup',
		0, 0, 1, 1);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(2, 1).tableCell);
	assertSelection(grid, 'Selection should not have changed without another mousedown',
		0, 0, 1, 1);

	com.qwirx.test.FakeBrowserEvent.mouseDown(grid.getCell(2, 1).tableCell);
	assertSelection(grid, 'Selection should have changed with click',
		2, 1, 2, 1);
	assertEquals("mousedown should have set current row", 1,
		grid.getCursor().getPosition());

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(1, 1).tableCell);
	assertSelection(grid, 'Selection should have changed with drag',
		2, 1, 1, 1);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(1, 0).tableCell);
	assertSelection(grid, 'Selection should have changed with drag',
		2, 1, 1, 0);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(1, 1).tableCell);
	assertSelection(grid, 'Selection should have changed with drag',
		2, 1, 1, 1);

	com.qwirx.test.FakeBrowserEvent.mouseOut(grid.getCell(0, 1).tableCell);
	assertSelection(grid, 'Selection should not have changed when mouse ' +
		'left the grid', 2, 1, 1, 1);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(0, 1).tableCell);
	assertSelection(grid, 'Selection should still be changeable after mouse ' +
		'left the grid and reentered in a different place',
		2, 1, 0, 1);

	com.qwirx.test.FakeBrowserEvent.mouseUp(grid.getCell(0, 0).tableCell);
	assertSelection(grid, 'Selection should not have changed with mouseup',
		2, 1, 0, 1);
}

function testGridLoadsDataFromDataSource()
{
	var grid = initGrid(ds);
	var columns = ds.getColumns();
	var expected = [];
	
	for (var r = 0; r < ds.getCount(); r++)
	{
		var expected_row = [];
		var item = ds.get(r);
		
		for (var c = 0; c < columns.length; c++)
		{
			var col_name = columns[c].name;
			var data = item[col_name];
			expected_row.push({value: data});
		}
		
		expected.push(expected_row);
	}
	
	assertGridContents(grid, expected);
}

function testGridHighlightModeColumns()
{
	var grid = initGrid(ds);
	
	var y_max = ds.getCount() - 1;

	// test that the header row doesn't become editable when clicked,
	// that text selection is disabled, and the entire column is
	// highlighted.
	com.qwirx.test.FakeBrowserEvent.mouseDown(grid.columns_[1].getIdentityNode());
	assertEquals(com.qwirx.grid.Grid.DragMode.COLUMNS,
		grid.dragMode_);
	assertSelection(grid, 'Selection should have changed with ' +
		'mousedown on header', 1, 0, 1, y_max);
	assertEquals("Header node should never allow text selection",
		false, grid.isAllowTextSelection());
	assertEquals("Header node should never be editable",
		"inherit", grid.columns_[1].getIdentityNode().contentEditable);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.columns_[2].getIdentityNode());
	assertSelection(grid, 'Selection should have changed with ' +
		'mouseover on header', 1, 0, 2, y_max);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(0, 0).tableCell);
	assertSelection(grid, 'Selection should have changed with ' +
		'mouseover on body', 1, 0, 0, y_max);

	com.qwirx.test.FakeBrowserEvent.mouseUp(grid.getCell(2, 0).tableCell);
	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(2, 1).tableCell);
	assertSelection(grid, 'Selection should not have changed with ' +
		'mouseover on body after mouseup', 1, 0, 0, y_max);
}

function testGridHighlightModeRows()
{
	var tds = new TestDataSource();
	var grid = initGrid(tds);
	
	var x_max = tds.getColumns().length - 1;
	assertEquals("cursor position should be at BOF initially",
		com.qwirx.data.Cursor.BOF, grid.getCursor().getPosition());
	
	// test that the header row doesn't become editable when clicked,
	// that text selection is disabled, and the entire column is
	// highlighted.
	tds.requestedRows = [];
	com.qwirx.test.FakeBrowserEvent.mouseDown(grid.rows_[0].getIdentityNode());
	assertEquals(com.qwirx.grid.Grid.DragMode.ROWS,
		grid.dragMode_);
	assertSelection(grid, 'Selection should have changed with ' +
		'mousedown on header', 0, 0, x_max, 0);
	assertEquals("Header node should never allow text selection",
		false, grid.isAllowTextSelection());
	assertEquals("Header node should never be editable",
		"inherit", grid.rows_[0].getIdentityNode().contentEditable);
	assertEquals("mousedown should have changed current row from BOF to 0", 0,
		grid.getCursor().getPosition());
	// TODO for efficiency it should really not reload anything
	/*
	assertObjectEquals("Change of cursor position should have loaded the " +
		"new current row", [grid.getCursor().getPosition()],
		tds.requestedRows);
	*/
	// Doing the same thing again should not load any rows, as it doesn't
	// result in a change of cursor position.
	com.qwirx.test.FakeBrowserEvent.mouseUp(grid.rows_[0].getIdentityNode());
	tds.requestedRows = [];
	com.qwirx.test.FakeBrowserEvent.mouseDown(grid.rows_[0].getIdentityNode());
	assertEquals("cursor should still be at position 0", 0,
		grid.getCursor().getPosition());
	assertObjectEquals("cursor position did not change, so no rows should " +
		"have been loaded", [], tds.requestedRows);
	
	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.rows_[1].getIdentityNode());
	assertSelection(grid, 'Selection should have changed with ' +
		'mouseover on header', 0, 0, x_max, 1);

	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(0, 0).tableCell);
	assertSelection(grid, 'Selection should have changed with ' +
		'mouseover on body', 0, 0, x_max, 0);

	com.qwirx.test.FakeBrowserEvent.mouseUp(grid.getCell(1, 0).tableCell);
	com.qwirx.test.FakeBrowserEvent.mouseOver(grid.getCell(1, 1).tableCell);
	assertSelection(grid, 'Selection should not have changed with ' +
		'mouseover on body after mouseup', 0, 0, x_max, 0);
}

var beer = {
	product: 'beer',
	strength: 'Refreshing, makes life more interesting/bearable',
	weakness: 'Fattening as hell'
};

function testGridInsertRowAt()
{
	var grid = initGrid(ds);
	
	var oldCount = ds.getCount();
	assertEquals('Grid should have been populated with some data',
		oldCount, grid.getVisibleRowCount());
	
	var oldRow0 = ds.get(0);
	var oldRow1 = ds.get(1);
	
	// insert a row between two others
	ds.insert(1, beer);
	assertEquals('Data source row count should have been updated',
		oldCount + 1, grid.getDatasource().getCount());
	
	function assertCellContents(rowIndex, contents)
	{
		com.qwirx.test.assertGreaterThan(grid.rows_.length, rowIndex,
			"Not enough rows in the grid");
		var scroll = grid.scrollOffset_;
		assertEquals("Grid seems to be displaying the wrong data row " +
			"on table row " + rowIndex, rowIndex + scroll.y,
			grid.rows_[rowIndex].getRowIndex());
		var cell = grid.getCell(0, rowIndex);
		assertNotNullNorUndefined("No grid cell found at " +
			"0," + rowIndex, cell);
		assertEquals("Wrong contents in grid cell ("+rowIndex+",0)",
			contents, cell.text);
		assertEquals("grid cell at 0," + rowIndex + " seems to be part " +
			"of the wrong row!", grid.rows_[rowIndex].getRowIndex(),
			cell.tableCell[com.qwirx.grid.Grid.TD_ATTRIBUTE_ROW].getRowIndex());
	}
	
	function assertCellContentsAndSelection(rowIndex, contents)
	{
		assertCellContents(rowIndex, contents);
		var scroll = grid.scrollOffset_;
		var cell = grid.getCell(0, rowIndex);
		
		com.qwirx.test.FakeBrowserEvent.mouseDown(cell.tableCell);
		assertSelection(grid, "Selection should have changed with " +
			"mousedown, and should be in virtual coordinates",
			0, rowIndex + scroll.y, 0, rowIndex + scroll.y);
		assertEquals("mousedown should have set current row",
			rowIndex + scroll.y, grid.getCursor().getPosition());
	}
	
	function assert_grid_contents_match_data_source()
	{
		for (var i = 0; i < grid.rows_.length; i++)
		{
			var dataSourceRow = i + grid.scrollOffset_.y;
			if (dataSourceRow < ds.getCount())
			{
				assertTrue(grid.rows_[i].isVisible());
				assertCellContents(i, ds.get(dataSourceRow).product);
			}
			else
			{
				assertFalse(grid.rows_[i].isVisible());
			}
		}
	}
	
	assert_grid_contents_match_data_source();
	
	// Test that inserting a row when scrolled also works
	grid.getCursor().setPosition(2);
	grid.setScroll(0, 1);
	assertEquals("Grid's cursor should be positioned at row 2 before " +
		"inserting data", 2, grid.getCursor().getPosition());
	assert_grid_contents_match_data_source();
	
	// reuse existing hidden grid row
	ds.insert(2, 
		{product: 'wine',
			strength: 'Traditional Roman drink, tasty',
			weakness: 'Hangovers, expensive'});
	assertEquals("Grid's cursor should be positioned at row 3 after " +
		"inserting data before the current row", 3,
		grid.cursor_.getPosition());
	assert_grid_contents_match_data_source();
	
	// forces creation of a new grid row
	ds.insert(3, 
		{product: 'whisky',
			strength: 'Traditional Scottish drink, tasty',
			weakness: 'Hangovers, expensive'});
	assertEquals("Grid's cursor should be positioned at row 4 after " +
		"inserting data before the current row", 4,
		grid.cursor_.getPosition());
	assert_grid_contents_match_data_source();
	
	grid.setScroll(0, 0);
	assert_grid_contents_match_data_source();
	
	// Need to moveFirst() before adding rows, otherwise we'll end up
	// scrolling to keep the current record visible, which will break the
	// following tests that assume that we're not scrolled.
	grid.getCursor().moveFirst();
	
	// Keep adding rows until the grid stops adding rows to match,
	// because it can't display any more.
	assertEquals("Can't test that grid stops adding rows unless the " +
		"row counts match to start with", ds.getCount(),
		grid.getVisibleRowCount());
	for (var i = 0; ds.getCount() == grid.getVisibleRowCount(); i++)
	{
		if (i > 10000)
		{
			throw new Error("emergency brakes!");
		}
		
		// If there are enough rows in the Datasource, then the Grid
		// will always keep adding rows until isPartialLastRow() is true.
		// Because it's not true, that should mean that there are not
		// enough records in the datasource to fill the screen, so all
		// records are visible and scrolling is impossible.
		
		assertEquals("all virtual grid rows are at least partially visible " +
			"on screen, so the number of grid rows should equal datasource " +
			"rows", ds.getCount(), grid.getVisibleRowCount());
		
		var lastRow = grid.rows_[grid.rows_.length - 1];
		if (lastRow.isVisible() && !lastRow.isFullyVisible())
		{
			// last time around; we'll exit the loop after adding another row,
			// because the grid isn't keeping up.
			assertEquals("the last physical grid row is partially hidden, " +
				"so the fully visible row count should be one less than " +
				"the partially visible row count", 1,
				grid.getVisibleRowCount() - grid.getFullyVisibleRowCount());
			assertEquals("the last physical grid row is partially hidden, " +
				"so the scroll bar should be enabled to allow access to it",
				ds.getCount() - grid.getFullyVisibleRowCount(),
				grid.scrollBar_.getMaximum());
		}
		else
		{	
			assertEquals("all virtual grid rows are visible on screen, " +
				"so the number of grid rows should equal datasource rows",
				ds.getCount(), grid.getFullyVisibleRowCount());
			assertEquals("all virtual grid rows are fully visible, " +
				"so the scroll bar should not be usable", 0,
				grid.scrollBar_.getMaximum());
		}
		
		ds.insert(3, {product: 'new product ' + i,
			strength: 'Better than product ' + (i-1),
			weakness: 'Soon to be obsolete'});
		assertEquals("Inserting a row should not have caused the grid " +
			"to scroll", 0, grid.scrollOffset_.y);
	}
	
	var lastRow = grid.rows_[grid.rows_.length - 1];
	assertTrue(lastRow.isVisible() && !lastRow.isFullyVisible());
	assertEquals("the last physical grid row is partially hidden, " +
		"so the scroll bar should be enabled to allow access to it",
		ds.getCount() - grid.getFullyVisibleRowCount(),
		grid.scrollBar_.getMaximum());
}

function assertGridContents(grid, data)
{
	assertEquals('Wrong number of rows in grid',
		data.length, grid.getVisibleRowCount());

	for (var rowIndex = 0; rowIndex < data.length; rowIndex++)
	{
		var rowData = data[rowIndex];
		for (var colIndex = 0; colIndex < rowData.length; colIndex++)
		{
			var cell = grid.rows_[rowIndex].getColumns()[colIndex].tableCell;
			assertEquals('Wrong value for row ' + rowIndex +
				' column ' + colIndex,
				rowData[colIndex].value.toString(), cell.innerHTML);
		}
	}
}

function testGridDataSourceEvents()
{
	var grid = initGrid(ds);

	assertGridContents(grid, data);
	
	data.push({id: 7, firstname: 'Paul'});
	ds.add(data[data.length-1]);
	assertGridContents(grid, data);
	
	data.splice(1, 0, {id: 8, firstname: 'Duke'});
	ds.insert(1, data[data.length-1]);
	assertGridContents(grid, data);
	
	var oldValue = data[1][1];
	data[1].firstname = 'Atreides';
	assertNotEquals('The data source should contain a ' +
		'deep copy of the data, not affected by external changed',
		'Atreides', ds.get(1).firstname);

	data[1].firstname = 'Leto';
	assertNotEquals('The data source should contain a ' +
		'deep copy of the data, not affected by external changed',
		'Leto', ds.get(1).firstname);
	data[1].firstname = oldValue;
	
	var iago = {id: 9, firstname: 'Iago'};
	ds.replace(2, iago);
	data.splice(2, 1, iago);
	assertGridContents(grid, data);
}	

var TestDataSource = function()
{
	this.requestedRows = [];
	this.rowCount = 10000;
};

goog.inherits(TestDataSource, com.qwirx.data.Datasource);

// http://station.woj.com/2010/02/javascript-random-seed.html
function random(max, seed)
{
	if (!seed)
	{
		seed = new Date().getTime();
	}
	seed = (seed*9301+49297) % 233280;
	return seed % max;
}

TestDataSource.prototype.get = function(rowIndex)
{
	this.assertValidRow(rowIndex, this.rowCount - 1);
	this.requestedRows.push(rowIndex);
	return {
		index: rowIndex,
		random: random(1000, rowIndex)
	};
};

TestDataSource.prototype.getCount = function()
{
	return this.rowCount;
};

TestDataSource.prototype.setRowCount = function(newRowCount)
{
	var oldRowCount = this.rowCount;
	this.rowCount = newRowCount;
	
	if (newRowCount > oldRowCount)
	{
		this.dispatchEvent(new com.qwirx.data.Datasource.RowEvent(
			com.qwirx.data.Datasource.Events.ROWS_INSERT,
			range(oldRowCount, newRowCount)));
	}
	else if (newRowCount < oldRowCount)
	{
		this.dispatchEvent(new com.qwirx.data.Datasource.RowEvent(
			com.qwirx.data.Datasource.Events.ROWS_DELETE,
			range(newRowCount, oldRowCount)));
	}
};

TestDataSource.prototype.getColumns = function()
{
	return [
		{name: 'index', caption: 'Row Index'},
		{name: 'random', caption: 'Random Number'}
	];
};

function testGridDataSource()
{
	var ds = new TestDataSource();
	var grid = initGrid(ds);

	assertEquals(ds, grid.getDatasource());
	assertEquals(ds, grid.getCursor().dataSource_);
}

function assertGridRowsVisible(grid, numRows)
{
	var len = grid.rows_.length;
	
	for (var i = 0; i < len; i++)
	{
		var visible = (i < numRows);
		assertEquals("Display style is wrong for row " + i +
			" with " + numRows + " total rows", visible ? '' : 'hidden',
			grid.rows_[i].getRowElement().style.visibility);
	}
}

function testGridRespondsToDataSourceRowCountChanges()
{
	var ds = new TestDataSource();
	var grid = initGrid(ds);
	assertObjectEquals("grid should initially have NO selection",
		com.qwirx.grid.Grid.NO_SELECTION, grid.drag);

	ds.setRowCount(1);
	assertEquals(0, grid.scrollBar_.getMaximum());
	assertObjectEquals("grid should still have NO selection",
		com.qwirx.grid.Grid.NO_SELECTION, grid.drag);
	assertTrue("The following tests will fail unless at least " +
		"one row is visible",
		grid.getVisibleRowCount() > 0);
	assertEquals(0, grid.scrollBar_.getMaximum());
	assertEquals(0, grid.scrollOffset_.x);
	assertEquals(0, grid.scrollOffset_.y);
	assertGridRowsVisible(grid, 1);

	// Keep adding rows until they can't all be displayed
	while (grid.getFullyVisibleRowCount() >= ds.getCount())
	{
		ds.setRowCount(ds.getCount() + 1);
	}
	assertEquals("Grid with datasource with 1 row more available " +
		"than visible should allow scrolling by 1 row", 1,
		grid.scrollBar_.getMaximum());
	assertEquals("Grid after datasource row count change should " +
		"still be positioned at left column", 0, grid.scrollOffset_.x);
	assertEquals("Grid after datasource row count change should " +
		"still be positioned at top row", 0, grid.scrollOffset_.y);
	// Slider is inverted, so 0 is at the bottom, and in this case
	// 1 is at the top.
	assertEquals("After datasource row count change, grid scrollbar " +
		"value should have been adjusted to maintain offset from bottom",
		1, grid.scrollBar_.getValue());
	assertGridRowsVisible(grid, grid.getVisibleRowCount());
	
	grid.scrollBar_.setValue(0); // scrolled down by 1 row
	assertEquals("Change to vertical scrollbar value should not have " +
		"changed horizonal scroll offset", 0, grid.scrollOffset_.x);
	assertEquals("Change to vertical scrollbar value should have " +
		"changed vertical scroll offset from bottom", 1,
		grid.scrollOffset_.y);
	assertGridRowsVisible(grid, grid.getFullyVisibleRowCount());

	// Changing datasource row count so that grid has fewer rows
	// should not change position.
	ds.setRowCount(grid.getFullyVisibleRowCount());
	assertEquals(1, grid.scrollBar_.getMaximum());
	assertEquals(0, grid.scrollOffset_.x);
	assertEquals(1, grid.scrollOffset_.y);
	// Slider is inverted, so 0 is at the bottom.
	assertEquals("The vertical scrollbar should be out of sync " +
		"with the grid contents, because the original scroll " +
		"position is no longer valid", 0, grid.scrollBar_.getValue());
	assertGridRowsVisible(grid, ds.getCount() - 1);

	// Same with just one row visible.
	ds.setRowCount(grid.scrollOffset_.y + 1);
	assertEquals(1, grid.scrollOffset_.y);
	// Slider is inverted, so 0 is at the bottom.
	assertEquals("The vertical scrollbar should still be out of sync " +
		"with the grid contents", 0, grid.scrollBar_.getValue());
	assertGridRowsVisible(grid, 1);

	// Changing datasource row count so that no rows are visible
	// should however change position to keep at least one visible.
	ds.setRowCount(1);
	assertEquals(0, grid.scrollBar_.getMaximum());
	assertEquals(0, grid.scrollOffset_.x);
	assertEquals("Changing datasource row count so that no rows " +
		"are visible should have changed scroll position to keep " +
		"at least one row visible.", 0, grid.scrollOffset_.y);
	// Slider is inverted, so 0 is at the bottom.
	assertEquals("The vertical scrollbar should not be out of sync " +
		"with the grid contents any more", 0, grid.scrollBar_.getValue());
	assertGridRowsVisible(grid, 1);
}

/**
 * This test currently fails due to a bug in Closure, and is
 * therefore disabled:
 * {@see http://code.google.com/p/closure-library/issues/detail?id=521}
 */
/*
function testScrollBarBehaviour()
{
	var scroll = new goog.ui.Slider;
	scroll.setMaximum(10000);
	scroll.setValue(9998);
	assertEquals(0, scroll.getExtent());
	scroll.setMaximum(10);
	scroll.setValue(8);
	assertEquals(8, scroll.getValue());
	assertEquals(0, scroll.getExtent());
}
*/

function range(a, b)
{
	var array = [];
	for (var i = 0; i <= (b - a); i++)
	{
		array[i] = a + i;
	}
	return array;
}

function testGridScrollAndHighlight()
{
	var ds = new TestDataSource();
	var grid = initGrid(ds);
	
	var gridRows = grid.getVisibleRowCount();
	assertObjectEquals(range(0, gridRows - 1), ds.requestedRows);
	
	var maxScroll = ds.getCount() - gridRows + 1;

	var scrollbar = grid.scrollBar_;
	assertNotNull(scrollbar);
	assertEquals('scrollbar has wrong minimum value', 0,
		scrollbar.getMinimum());
	assertEquals('scrollbar has wrong maximum value', maxScroll,
		scrollbar.getMaximum());
	// slider is inverted, so the maximum value is at the top
	assertEquals('scrollbar should be at maximum value (top)',
		scrollbar.getMaximum(), scrollbar.getValue());
	assertEquals(0, scrollbar.getExtent());

	ds.requestedRows = [];
	scrollbar.setValue(0); // slider is inverted, so 0 is at the bottom
	assertObjectEquals({x: 0, y: maxScroll},
		grid.scrollOffset_);
	assertObjectEquals(range(maxScroll,	ds.getCount() - 1),
		ds.requestedRows);
	
	grid.setSelection(1, 1, 2, 4);
	assertSelection(grid, "setSelection method should change selection",
		1, 1, 2, 4);

	ds.requestedRows = [];
	scrollbar.setValue(maxScroll - 2); // 2 from the top
	assertObjectEquals('wrong set of rows were loaded from datasource',
		range(2, gridRows + 1), ds.requestedRows);
	assertObjectEquals({x: 0, y: 2}, grid.scrollOffset_);
	assertSelection(grid, "scrolling should not have changed selection",
		1, 1, 2, 4);

	// Shrink the row count a bit, check that scrollbar is adjusted
	grid.setSelection(1, 1, 2, 4);
	ds.requestedRows = [];
	ds.setRowCount(gridRows * 2); // but the first two are offscreen
	maxScroll = ds.getCount() - grid.getFullyVisibleRowCount();
	assertEquals("row count change should have reset scrollbar maximum",
		maxScroll, scrollbar.getMaximum());
	assertEquals("row count change should have adjusted scrollbar " +
		"value to maintain position 2 rows down from the top",
		scrollbar.getMaximum() - 2, scrollbar.getValue());
	assertObjectEquals("Removing offscreen rows should not require " +
		"repainting onscreen ones", [], ds.requestedRows);
	assertObjectEquals({x: 0, y: 2}, grid.scrollOffset_);
		
	// Shrink the row count to less than the selection, check that
	// scrollbar is adjusted (maximum should be 0) and selection
	// truncated to new row count.
	grid.setSelection(1, 1, 2, gridRows + 2);
	ds.requestedRows = [];
	
	// Test that setting datasource rows to fewer than visible rows
	// disables scrolling. It must be fewer, because the last row
	// may be only partially visible, so you might have to scroll
	// to see it.
	ds.setRowCount(gridRows - 1); // but the first two are offscreen
	assertEquals("row count change should not have changed scrollbar " +
		"maximum, as the old position is still valid", 2,
		scrollbar.getMaximum());
	assertEquals("row count change should have left scrollbar at the " +
		"extreme bottom (minimum) value, as the old position is still " +
		"valid, but only just", 0, scrollbar.getValue());
	assertEquals("row count change should not have changed scroll offset, " +
		"as the old position is still valid", 2,
		grid.scrollOffset_.y);
	assertSelection(grid, "shrinking datasource should have shrunk " +
		"selection", 1, 1, 2, gridRows - 2);
	
	// the grid scroll offset is left at 2, no longer matching the
	// scroll position, to avoid a visual jump
	assertObjectEquals({x: 0, y: 2}, grid.scrollOffset_);
	assertObjectEquals("Removing rows should not require " +
		"repainting onscreen ones", [], ds.requestedRows);
	
	// a CHANGE event should not cause either the scrollbar value or the
	// grid's scroll offset to change.
	ds.requestedRows = [];
	grid.scrollBar_.dispatchEvent(goog.ui.Component.EventType.CHANGE);
	assertObjectEquals({x: 0, y: 2}, grid.scrollOffset_);
	assertObjectEquals("Removing rows should not require " +
		"repainting onscreen ones", [], ds.requestedRows);

	// But scrolling should repaint everything onscreen
	grid.setScroll(0, 1);
	assertObjectEquals({x: 0, y: 1}, grid.scrollOffset_);
	assertObjectEquals(range(1, gridRows - 2), ds.requestedRows);

	// reset for manual testing, playing and demos
	var dataRows = 10000;
	ds.setRowCount(dataRows);
	maxScroll = dataRows - grid.getFullyVisibleRowCount();
	
	// highlight the last row, scroll back to the top and simulate
	// a click. This used to try to unhighlight an HTML table row
	// element with a massive index, because scroll was not taken
	// into account.
	grid.setSelection(0, dataRows - 1, 1, dataRows - 1);

	assertEquals(maxScroll, scrollbar.getMaximum());
	scrollbar.setValue(maxScroll); // at the top
	assertEquals(maxScroll, scrollbar.getValue());
	
	var cell = grid.rows_[0].getColumns()[0].tableCell;
	assertEquals(0,
		cell[com.qwirx.grid.Grid.TD_ATTRIBUTE_ROW].getRowIndex());
	com.qwirx.test.FakeBrowserEvent.mouseDown(cell);
	assertSelection(grid, 'Selection should have changed with mousedown',
		0, 0, 0, 0);
	assertEquals("mousedown should have set current row", 0,
		grid.getCursor().getPosition());
}

/**
 * It's not enough for the grid navigation buttons to listen for
 * onClick events; they must also intercept mouse events to avoid
 * them being sent to the grid, where they will cause all kinds of
 * trouble.
 */
function testGridNavigationButtonsInterceptMouseEvents()
{
	var ds = new TestDataSource();
	var grid = initGrid(ds);

	var buttons = [false, // included to ensure initial conditions
		grid.nav_.firstButton_,
		grid.nav_.prevPageButton_,
		grid.nav_.prevButton_,
		grid.nav_.nextButton_,
		grid.nav_.nextPageButton_,
		grid.nav_.lastButton_];

	// Patch the grid control to intercept mouseDown and mouseUp
	// events, which should be intercepted before they reach it.
	function f(e)
	{
		fail(e.type + " event propagation should be stopped " +
			"before reaching the Grid");
	}
	
	var handler = grid.getHandler();
	var element = grid.getElement();
	handler.listen(element, goog.events.EventType.MOUSEDOWN, f);
	handler.listen(element, goog.events.EventType.MOUSEUP, f);
	
	for (var i = 0; i < buttons.length; i++)
	{
		var button = buttons[i];
		
		if (button == false)
		{
			// test initial conditions
		}
		else if (!button.isEnabled())
		{
			// can't send events to disabled buttons!
		}
		else
		{
			var events = com.qwirx.test.assertEvents(button,
				[com.qwirx.util.ExceptionEvent.EVENT_TYPE],
				function()
				{
					com.qwirx.test.FakeClickEvent.send(button);
				},
				"The grid navigation button did not intercept the event",
				true /* opt_continue_if_exception_not_thrown */);
			
			// If an event was thrown at all, it must be an ExceptionEvent
			// and contain the right kind of exception.
			if (events.length)
			{
				var exception = events[0].getException();
				goog.asserts.assertInstanceof(exception,
					com.qwirx.data.IllegalMove);
			}
		}
		
		assertSelection(grid, "should be no selection",
			-1, -1, -1, -1);
		
		// MOUSEUP does actually trigger an action, so it will
		// move the cursor, so we can't test this:
		/*
		assertEquals("cursor should not have moved on " +
			buttonName + " button click", com.qwirx.data.Cursor.BOF,
			grid.getCursor().getPosition());
		var buttonName = (button ? button.getContent() : "no");
		assertEquals("grid should not have scrolled on " +
			buttonName + " button click", 0, grid.scrollOffset_.y);
		*/
	}
}

function assertNavigationButtonStates(grid)
{
	var position = grid.nav_.getCursor().getPosition();
	var rows = grid.dataSource_.getCount();
	var BOF = com.qwirx.data.Cursor.BOF;
	var EOF = com.qwirx.data.Cursor.EOF;
	var NEW = com.qwirx.data.Cursor.NEW;
	var inData = (position != BOF && position != EOF && position != NEW);
	assertTrue("cannot be positioned in the data when there isn't any",
		rows != 0 || !inData);
	
	function message(buttonName)
	{
		return "wrong enabled state for " + buttonName + " at " +
			position + " of " + (rows >= 0 ? rows : "indeterminate") + " rows";
	}
	
	assertEquals(message("firstButton_"),
		position != 0, grid.nav_.firstButton_.isEnabled());
	assertEquals(message("prevPageButton_"),
		position != BOF, grid.nav_.prevPageButton_.isEnabled());
	assertEquals(message("prevButton_"),
		position != BOF, grid.nav_.prevButton_.isEnabled());
	assertEquals(message("nextButton_"),
		position != EOF, grid.nav_.nextButton_.isEnabled());
	assertEquals(message("nextPageButton_"),
		position != EOF, grid.nav_.nextPageButton_.isEnabled());
	
	// TODO should we allow moving to the end of a dataset of
	// indeterminate size? it might take forever, but if not, it
	// could save the user a lot of time paging through it manually!
	assertEquals(message("lastButton_"),
		rows == -1 || position != rows - 1, grid.nav_.lastButton_.isEnabled());
}

function assertCurrentRowHighlight(grid)
{
	// Check that the row highlighter has been updated
	var currentPosition = grid.getCursor().getPosition();
	var currentGridRowIndex;
	
	if (currentPosition == com.qwirx.data.Cursor.NEW)
	{
		currentGridRowIndex = grid.getCursor().getRowCount() -
			grid.scrollOffset_.y;
		// one row past the far end of the data source
	}
	else
	{
		var currentDataRowIndex = currentPosition;
		currentGridRowIndex = currentDataRowIndex - grid.scrollOffset_.y;
	}
	
	var css;
	
	if (currentGridRowIndex >= 0 && 
		currentGridRowIndex < grid.rows_.length)
	{
		css = 'table#' + grid.dataTable_.id +
			' > tr.row_' + currentGridRowIndex + 
			' > th { background-color: #88f; }';
	}
	else
	{
		css = "";
	}	

	assertEquals("Wrong highlight CSS to highlight grid row " + 
		currentGridRowIndex, css, grid.currentRowStyle_.textContent);
}	

function assertNavigateGrid(grid, startPosition, button,
	expectedPosition, expectedScroll, positionMessage, scrollMessage)
{
	grid.nav_.getCursor().setPosition(startPosition);
	assertEquals("starting position row number in Cursor",
		startPosition, grid.nav_.getCursor().getPosition());
	assertEquals("starting position text field contents",
		startPosition + "", grid.nav_.rowNumberField_.getValue());
	
	var rows = grid.dataSource_.getCount();
	assertEquals("scroll bar maximum should allow full access to all " +
		"fully visible rows", rows - grid.getFullyVisibleRowCount(), 
		grid.scrollBar_.getMaximum());
	
	// button states should be correct before navigating
	assertNavigationButtonStates(grid);
	
	if (!button.isEnabled())
	{
		// can't send an event to a disabled button!
		return;
	}
	
	if (!scrollMessage)
	{
		var initialScroll = grid.scrollOffset_.y;
		if (initialScroll != expectedScroll)
		{
			scrollMessage = "selecting an offscreen record should " +
				"scroll until record is in view";
		}
		else
		{
			scrollMessage = "selecting an onscreen record should " +
				"not scroll";
		}
	}
	
	com.qwirx.test.FakeClickEvent.send(button);
	assertEquals(positionMessage, expectedPosition,
		grid.nav_.getCursor().getPosition());
	assertEquals(scrollMessage, expectedScroll, grid.scrollOffset_.y);
	assertEquals("After moving to " + positionMessage + ", the position " +
		"text box should be updated with the new position",
		"" + expectedPosition, grid.nav_.rowNumberField_.getContent());
	
	var expectedScrollBarMaximum = rows - grid.getFullyVisibleRowCount();
	if (expectedPosition == com.qwirx.data.Cursor.NEW)
	{
		expectedScrollBarMaximum++;
	}
	assertEquals("scroll bar maximum should still be the same, to allow " +
		"full access to all rows", expectedScrollBarMaximum,
		grid.scrollBar_.getMaximum());
	assertEquals("final scroll bar position",
		expectedScrollBarMaximum - expectedScroll,
		grid.scrollBar_.getValue());
	
	var lastRow = grid.rows_[grid.rows_.length - 1];
	assertTrue("The last row should be partially visible",
		lastRow.isPartiallyVisible());
	assertFalse("The last row should not be fully visible",
		lastRow.isFullyVisible());
	for (var i = 0; i < grid.rows_.length; i++)
	{
		var dataRow = i + expectedScroll;
		var shouldBeVisible = (dataRow < grid.getRowCount());
		assertEquals("all grid rows that correspond to data rows should be " +
			"visible", shouldBeVisible ? "" : "hidden",
			grid.rows_[i].tableRowElement_.style.visibility);
	}
	
	assertEquals(expectedPosition, grid.getCursor().getPosition());
	assertCurrentRowHighlight(grid, expectedPosition);

	// button states should have been updated too
	assertNavigationButtonStates(grid);
}

function assertNavigationException(grid, startPosition, button, message)
{
	grid.nav_.getCursor().setPosition(startPosition);
	assertEquals(startPosition, grid.nav_.getCursor().getPosition());
	// button states should be correct before navigating
	assertNavigationButtonStates(grid);
	
	if (button.isEnabled())
	{
		// Browser event handlers should NOT throw exceptions, because
		// nothing can intercept them and handle them properly. They should
		// throw a {@link com.qwirx.util.ExceptionEvent} at themselves
		// instead.
		com.qwirx.test.assertEvents(button,
			[com.qwirx.util.ExceptionEvent.EVENT_TYPE],
			function() { com.qwirx.test.FakeClickEvent.send(button); },
			message);
	}
}

function testGridNavigation()
{
	var ds = new TestDataSource();
	var grid = initGrid(ds);

	var BOF = com.qwirx.data.Cursor.BOF;
	var EOF = com.qwirx.data.Cursor.EOF;
	var NEW = com.qwirx.data.Cursor.NEW;
	
	var dataRows = ds.getCount();
	var gridRows = grid.getFullyVisibleRowCount();
	var maxScroll = dataRows - gridRows;
	var lastRecord = dataRows - 1;
	
	assertTrue("we will scroll unexpectedly if gridRows < 3, " +
		"breaking the tests", gridRows >= 3);
	/*
	assertFalse("toolbar should not be focusable, so it doesn't " +
		"steal focus from its buttons on bubble up",
		goog.dom.isFocusableTabIndex(grid.nav_.getElement()));
	*/

	assertEquals("cursor should be positioned at BOF initially",
		BOF, grid.nav_.getCursor().getPosition());

	// movements from BOF
	assertNavigateGrid(grid, BOF, grid.nav_.nextButton_, 0, 0,
		"next record from BOF");
	assertNavigateGrid(grid, BOF, grid.nav_.nextPageButton_, gridRows - 1,
		0, "next page from BOF takes us one less than a pageful down");
	assertNavigateGrid(grid, BOF, grid.nav_.lastButton_, lastRecord,
		maxScroll, "last record from BOF");
	assertNavigationException(grid, BOF, grid.nav_.prevButton_,
		"previous record from BOF should throw exception");
	assertNavigationException(grid, BOF, grid.nav_.prevPageButton_,
		"previous record from BOF should throw exception");
	assertNavigateGrid(grid, BOF, grid.nav_.firstButton_, 0, 0,
		"first record from BOF");
	assertEquals("Grid should currently only be displaying rows from " +
		"the data source", dataRows, grid.getRowCount());
	assertNavigateGrid(grid, BOF, grid.nav_.newButton_, NEW, maxScroll + 1,
		"new record from BOF");
	assertEquals("Grid should now be displaying one more row than " +
		"the data source contains, for the new record", dataRows + 1,
		grid.getRowCount());

	// movements from record 0
	assertNavigateGrid(grid, 0, grid.nav_.nextButton_, 1, 0,
		"next record from 0");
	assertEquals("Grid should have returned to only displaying rows from " +
		"the data source", dataRows, grid.getRowCount());
	assertNavigateGrid(grid, 0, grid.nav_.nextPageButton_, gridRows,
		1, "next page from 0", "moving the selection down by a " +
		"pageful, and keeping the currently selected row visible, " +
		"requires the grid to scroll down by 1 row.");
	assertNavigateGrid(grid, 0, grid.nav_.lastButton_, lastRecord,
		maxScroll, "last record from 0");
	assertNavigateGrid(grid, 0, grid.nav_.prevButton_, BOF, 0,
		"previous record from 0");
	assertNavigateGrid(grid, 0, grid.nav_.prevPageButton_, BOF, 0,
		"previous page from 0");
	assertNavigateGrid(grid, 0, grid.nav_.firstButton_, 0, 0,
		"first record from 0");

	// movements from record 1
	assertNavigateGrid(grid, 1, grid.nav_.nextButton_, 2, 0,
		"next record from 1");
	assertNavigateGrid(grid, 1, grid.nav_.nextPageButton_, gridRows + 1,
		2, "next page from 0", "moving the selection down by a " +
		"pageful, and keeping the currently selected row visible, " +
		"requires the grid to scroll down by 2 rows.");
	assertNavigateGrid(grid, 1, grid.nav_.lastButton_, lastRecord,
		maxScroll, "last record from 1");
	assertNavigateGrid(grid, 1, grid.nav_.prevButton_, 0, 0,
		"previous record from 1");
	assertNavigateGrid(grid, 1, grid.nav_.prevPageButton_, BOF, 0,
		"previous page from 1");
	assertNavigateGrid(grid, 1, grid.nav_.firstButton_, 0, 0,
		"first record from 1");
	
	// movement from visibleRows - 1
	var fullyVisibleRows = grid.getFullyVisibleRowCount();
	assertNavigateGrid(grid, fullyVisibleRows - 1, grid.nav_.nextButton_,
		fullyVisibleRows /* expectedPosition */,
		1 /* expectedScroll */, "next record from " + (fullyVisibleRows - 2),
		"moving forward 1 row from position " + (fullyVisibleRows - 1) +
		" should scroll down by 1 row to keep the current row visible");
	assertNavigateGrid(grid, fullyVisibleRows - 1, grid.nav_.nextPageButton_,
		fullyVisibleRows * 2 - 1 /* expectedPosition */,
		fullyVisibleRows /* expectedScroll */,
		"next page from " + (fullyVisibleRows - 2),
		"moving forward 1 page from position " + (fullyVisibleRows - 1) +
		" should scroll down by " + fullyVisibleRows + " rows to keep the " +
		"current row visible");
		
	// Movements from record gridRows-1 (second page of rows)
	grid.setScroll(0, gridRows-1);
	assertNavigateGrid(grid, gridRows-1, grid.nav_.prevPageButton_,
		BOF, 0, "previous page from gridRows-1");

	// Movements from record lastRecord-gridRows+1
	grid.setScroll(0, lastRecord-gridRows);
	assertNavigateGrid(grid, lastRecord-gridRows+1,
		grid.nav_.nextPageButton_, EOF, lastRecord-gridRows+1,
		"next page from lastRecord-gridRows+1");

	// movements from record lastRecord-1
	assertNavigateGrid(grid, lastRecord-1, grid.nav_.nextButton_,
		lastRecord, maxScroll,
		"next record from lastRecord-1");
	assertNavigateGrid(grid, lastRecord-1, grid.nav_.nextPageButton_,
		EOF, maxScroll, "next page from lastRecord-1");
	assertNavigateGrid(grid, lastRecord-1, grid.nav_.lastButton_,
		lastRecord, maxScroll, "last record from lastRecord-1");
	assertNavigateGrid(grid, lastRecord-1, grid.nav_.prevButton_,
		lastRecord - 2, maxScroll, "previous record from lastRecord-1");
	assertNavigateGrid(grid, lastRecord-1, grid.nav_.prevPageButton_,
		lastRecord - gridRows - 1, maxScroll - 2,
		"previous page from lastRecord-1",
		"should have to scroll up 2 rows to display newly active row");
	assertNavigateGrid(grid, lastRecord-1, grid.nav_.firstButton_, 0, 0,
		"first record from lastRecord-1");

	// movements from record lastRecord
	assertNavigateGrid(grid, lastRecord, grid.nav_.nextButton_,
		EOF, maxScroll, "next record from lastRecord");
	assertNavigateGrid(grid, lastRecord, grid.nav_.nextPageButton_,
		EOF, maxScroll, "next page from lastRecord");
	assertNavigateGrid(grid, lastRecord, grid.nav_.lastButton_,
		lastRecord, maxScroll, "last record from lastRecord");
	assertNavigateGrid(grid, lastRecord, grid.nav_.prevButton_,
		lastRecord - 1, maxScroll, "previous record from lastRecord");
	assertNavigateGrid(grid, lastRecord, grid.nav_.prevPageButton_,
		lastRecord - gridRows, maxScroll - 1,
		"previous page from lastRecord",
		"should have to scroll up 1 row to display newly active row");
	assertNavigateGrid(grid, lastRecord, grid.nav_.firstButton_, 0, 0,
		"first record from lastRecord");

	// movements from EOF
	assertNavigationException(grid, EOF, grid.nav_.nextButton_,
		"next record from EOF");
	assertNavigationException(grid, EOF, grid.nav_.nextPageButton_,
		"next page from EOF");
	assertNavigateGrid(grid, EOF, grid.nav_.lastButton_,
		lastRecord, maxScroll, "last record from EOF");
	assertNavigateGrid(grid, EOF, grid.nav_.prevButton_,
		lastRecord, maxScroll, "previous record from EOF");
	assertNavigateGrid(grid, EOF, grid.nav_.prevPageButton_,
		lastRecord - gridRows + 1, maxScroll,
		"previous page from EOF",
		"should not have to scroll to display newly active row");
	assertNavigateGrid(grid, EOF, grid.nav_.firstButton_, 0, 0,
		"first record from EOF");
}

/**
 * If we create the grid, insert rows into its data source (causing a
 * {@link com.qwirx.data.Datasource.Events.ROWS_INSERT} event) and then
 * render the grid, it used to add the existing rows again, causing
 * duplicate rows.
 */
function testGridInsertRowsIntoDataSourceBeforeRender()
{
	var container = new goog.ui.Component();
	container.decorate(domContainer);
	
	var grid = new com.qwirx.grid.NavigableGrid(ds);
	var oldCount = ds.getCount();
	
	// Add a row between new() and createDom()
	ds.add({product: 'fish', strength: 'Full of omega oils',
		weakness: 'Smells of fish, goes bad quickly, not vegan compatible'});
	
	grid.createDom();
	// Add a row between createDom() and enterDocument()
	ds.add({product: 'cheese', strength: 'Tasty, smelly, vegetarian',
		weakness: 'Cows produce methane, some people are intolerant'});
	// The grid doesn't know how many rows or columns it contains;
	// it doesn't know how many rows will fit, and it therefore hasn't
	// queried the datasource, so it doesn't know what the columns
	// are either.
	assertObjectEquals([], grid.columns_);
	assertObjectEquals([], grid.rows_);
	
	grid.addClassName('fb-datagrid');
	container.addChild(grid, true /* opt_render */);
	assertEquals("Grid should have the same number of rows as the datasource",
		ds.getCount(), grid.rows_.length);
	
	var oldRows = grid.rows_;
	var oldHeaderRow = grid.headerRow_;
	// Check that it's OK to remove the grid from the document and add it again
	container.removeChild(grid, true /* opt_unrender */);
	
	assertObjectEquals("The grid should have forgotten all its columns",
		[], grid.columns_);
	assertObjectEquals("The grid should have forgotten all its rows",
		[], grid.rows_);
	assertUndefined("The grid should have forgotten its header row",
		grid.headerRow_);
	
	// All the old rows should have been removed from the document
	for (var i = 0; i < oldRows.length; i++)
	{
		assertNull("Row "+i+" should have been removed from the document",
			oldRows[i].tableRowElement_.parentNode);
	}
	assertNull("Header row should have been removed from the document",
		oldHeaderRow.parentNode);
	
	container.addChild(grid, true /* opt_render */);
	assertEquals("Grid should still have the same number of rows " +
		"as the datasource", ds.getCount(), grid.rows_.length);
}

function testGridRowsAreAllOnScreen()
{
	var tds = new TestDataSource();
	var grid = initGrid(tds);
	var outer = grid.wrapper.getElement();
	
	for (var i = 0; i < grid.rows_.length; i++)
	{
		var row = grid.rows_[i];
		var elem = row.tableRowElement_;
		assertTrue("row " + i + " top " + elem.offsetTop +
			" should be less than grid element bottom " +
			(outer.offsetTop + outer.offsetHeight),
			elem.offsetTop <= outer.offsetTop + outer.offsetHeight);
		var expectOverflow = (i == grid.rows_.length - 1);
		assertEquals("row " + i + " bottom " +
			(elem.offsetTop + elem.offsetHeight) + " should " +
			(expectOverflow ? "not " : "") + "be less than " +
			"grid element bottom " + (outer.offsetTop + outer.offsetHeight),
			expectOverflow,
			elem.offsetTop + elem.offsetHeight > outer.offsetTop + outer.offsetHeight);
		
		assertEquals("All rows should be at least partially visible", true,
			row.isPartiallyVisible());
		assertEquals("The last row should not be fully visilbe",
			!expectOverflow, row.isFullyVisible());
		
		var cells = row.tableDataCells_;
		for (var j = 1; j < cells.length; j++)
		{
			assertNotEquals("Cell should have contents loaded", "",
				cells[j].innerHTML);
		}
	}
}

function testInsertRowIntoSelectedArea()
{
	var grid = initGrid(ds);
	
	ds.insert(1, beer);
	assertObjectEquals("inserting into datasource with no selected area " +
		"should have no effect", com.qwirx.grid.Grid.NO_SELECTION, grid.drag);
	
	grid.setSelection(1, 2, 3, 4);
	assertObjectEquals("setSelection should have set the selection to this",
		{x1: 1, y1: 2, x2: 3, y2: 4}, grid.drag);
	
	ds.insert(5, beer);
	assertObjectEquals("inserting into datasource after selected area " +
		"should have no effect", {x1: 1, y1: 2, x2: 3, y2: 4}, grid.drag);
	
	ds.insert(1, beer);
	assertObjectEquals("inserting into datasource before selected area " +
		"should have moved selection down by 1 row",
		{x1: 1, y1: 3, x2: 3, y2: 5}, grid.drag);
	
	ds.insert(3, beer);
	assertObjectEquals("inserting into datasource just before selected " +
		"area should have moved selection down by 1 row",
		{x1: 1, y1: 4, x2: 3, y2: 6}, grid.drag);
	
	ds.insert(5, beer);
	assertObjectEquals("inserting into datasource inside selected area " +
		"should have moved selection end down by 1 row",
		{x1: 1, y1: 4, x2: 3, y2: 7}, grid.drag);
	
	ds.insert(7, beer);
	assertObjectEquals("inserting into datasource at end of selected area " +
		"should have moved selection end down by 1 row",
		{x1: 1, y1: 4, x2: 3, y2: 8}, grid.drag);
	
	ds.insert(9, beer);
	assertObjectEquals("inserting into datasource after selected area " +
		"should have no effect", {x1: 1, y1: 4, x2: 3, y2: 8}, grid.drag);
}

function test_changing_row_height_adds_rows_when_needed()
{
	var grid = initGrid(ds);
	var oldCount = ds.getCount();
	
	var bamboo = {
		product: 'bamboo',
		strength: 'Grows quickly',
		weakness: 'Only edible in China'
	};
	
	ds.insert(1, bamboo);
	var newCount = ds.getCount();
	assertEquals("We just added a row, so the datasource should have " +
		"one more row than before", oldCount + 1, newCount);
	
	var oldScroll = grid.scrollOffset_.y;
	assertEquals(0, oldScroll);
	assertEquals(0, grid.scrollBar_.getMaximum());
	
	for (var i = 0;; i++)
	{
		var wrapper = grid.wrapper.getElement();
		
		var lastRowIndex = grid.rows_.length - 1;
		var lastRow = grid.rows_[lastRowIndex].getRowElement();
		var lastRowPos = goog.style.getPageOffset(lastRow);
		var wrapperPos = goog.style.getPageOffset(wrapper);
		
		if (wrapperPos.y + wrapper.clientHeight < lastRowPos.y)
		{
			// The last row should be fully hidden. 
			assertEquals("One record in the Datasource should be partially hidden",
				ds.getCount() - 1, grid.getVisibleRowCount());
			assertEquals("One record in the Datasource should be fully hidden",
				// Depending on whether the last visible row happens to fit
				// exactly into the available space, the fully visible row
				// count might be the same as the partially visible, or not.
				ds.getCount() -
				(grid.rows_[grid.rows_.length - 2].isFullyVisible() ? 1 : 2),
				grid.getFullyVisibleRowCount());
			break;
		}			
		else if (wrapperPos.y + wrapper.clientHeight <
			lastRowPos.y + lastRow.clientHeight)
		{
			assertFalse("The last row is no longer fully visible, so " +
				"grid.canAddMoreRows() should return false", 
				grid.canAddMoreRows());
			
			var lastRow = grid.rows_[grid.rows_.length - 1];
			assertTrue("The last physical grid row is partially hidden, and " +
				"the grid should know it", lastRow.isPartiallyVisible() &&
				!lastRow.isFullyVisible());
			
			assertEquals("All records in the Datasource should be at least " +
				"partially visible", newCount, grid.getVisibleRowCount());
			
			assertEquals("The last physical grid row is partially hidden, so " +
				"the fully visible row count should be 1 less than the total " +
				"row count", newCount - 1, grid.getFullyVisibleRowCount());
			
			assertEquals("The last physical grid row is partially hidden, so " +
				"the scroll bar should be configured to allow access to it",
				1, grid.scrollBar_.getMaximum());
		}
		else
		{
			assertTrue("The last row is still fully visible, so " +
				"grid.canAddMoreRows() should return true",
				grid.canAddMoreRows());
			
			assertTrue("The last physical grid row is fully visible, and " +
				"the grid should know it", 
			   grid.rows_[grid.rows_.length - 1].isFullyVisible());
			
			assertEquals("All records in the Datasource should be at least " +
				"partially visible", newCount, grid.getVisibleRowCount());
			
			assertEquals("All records in the Datasource should be at least " +
				"fullyvisible", newCount, grid.getFullyVisibleRowCount());
			
			assertEquals("The last physical grid row is fully visible, so " +
				"the scroll bar should be configured not to allow scrolling",
				0, grid.scrollBar_.getMaximum());
		}
		
		var table = grid.dataTable_;
		var oldHeight = table.clientHeight;
		
		bamboo.strength += "\nlonger";
		ds.replace(1, bamboo);
		
		var newScroll = grid.scrollOffset_.y;
		assertEquals("The grid's scroll should not have changed by " +
			"changing row contents", 0, newScroll);
		
		assertEquals("The scroll bar is inverted, and should still be " +
			"positioned at the top (maximum)", grid.scrollBar_.getMaximum(),
			grid.scrollBar_.getValue());
		
		var newHeight = table.clientHeight;
		com.qwirx.test.assertGreaterThan(newHeight, oldHeight,
			"grid container should be taller now");
		
		if (i > 10000)
		{
			fail("grid never filled up vertically");
		}
	}
}

function test_empty_grid_scroll_maximum_is_valid()
{
	var emptyDs = new com.qwirx.data.SimpleDatasource(columns, []);
	var grid = initGrid(emptyDs);
	// check that the scroll maximum is valid
	assertEquals(0, grid.getFullyVisibleRowCount());
}

function assert_setup_modified_grid_row(grid, button, startPosition)
{
	if (grid.getCursor().isDirty())
	{
		grid.getCursor().discard();
	}
	
	com.qwirx.test.FakeClickEvent.send(button);
	assertEquals(startPosition, grid.getCursor().getPosition());
	assertEquals("should the grid be positioned on a temporary new row?",
		(grid.getCursor().getPosition() == com.qwirx.data.Cursor.NEW),
		grid.isPositionedOnTemporaryNewRow);
	var oldValues = grid.getCursor().getCurrentValues();
	
	var rowIndex = grid.getRowCount() - grid.scrollOffset_.y - 1;
	var cells = grid.rows_[rowIndex].getColumns();
	
	// fake a change to dirty the whole row
	// grid.dispatchEvent('change', cells[0]);
	grid.setEditableCell(cells[0].tableCell);
	cells[0].tableCell.innerHTML = 'computers';
	grid.editableCellField_.dispatchEvent(
		goog.editor.Field.EventType.DELAYEDCHANGE);
	assertTrue("Cursor should be dirty after modifying grid values",
		grid.getCursor().isDirty());
	
	oldValues.product = 'computers';
	assertObjectEquals("Modified values should have been copied into the Cursor",
		oldValues, grid.getCursor().getCurrentValues());
}

function test_grid_create_new_row_then_discard()
{
	var grid = initGrid(ds);
	var oldCount = ds.getCount();
	
	assert_setup_modified_grid_row(grid, grid.nav_.newButton_,
		com.qwirx.data.Cursor.NEW);
	
	var events = com.qwirx.test.assertEvents(grid.getCursor(),
		[
			com.qwirx.data.Cursor.Events.BEFORE_DISCARD,
			com.qwirx.data.Cursor.Events.DISCARD
		],
		function()
		{
			expect_dialog(function()
				{
					com.qwirx.test.FakeClickEvent.send(grid.nav_.prevButton_);
				},
				goog.ui.Dialog.DefaultButtonKeys.CONTINUE);
		},
		"Moving off the NEW row should have sent a DISCARD event",
		false, // opt_continue_if_events_not_sent
		function (event) // opt_eventHandler
		{
			var expected_position = grid.getDatasource().getCount() - 1;
			assertEquals("The requested position should be stored in the " +
				"event object", expected_position, event.getNewPosition());
			return true; // allows us to proceed from BEFORE_DISCARD
		});
	assertEquals(oldCount - 1, grid.getCursor().getPosition());
}

function assert_grid_response_to_dirty_dialog(grid, response_button,
	expected_cursor_events, opt_eventingCallback, opt_AttemptedPosition)
{
	expected_cursor_events = [com.qwirx.data.Cursor.Events.BEFORE_DISCARD].
		concat(expected_cursor_events);
	var old_position = grid.getCursor().getPosition();
	if (opt_AttemptedPosition === undefined)
	{
		opt_AttemptedPosition = grid.getDatasource().getCount() - 1;
	}
	var new_row_position = grid.getDatasource().getCount();
	
	var actual_events = com.qwirx.test.assertEvents(grid.getCursor(),
		expected_cursor_events,
		function()
		{
			expect_dialog(opt_eventingCallback || function()
				{
					com.qwirx.test.FakeClickEvent.send(grid.nav_.prevButton_);
				},
				response_button);
			
			if (response_button == goog.ui.Dialog.DefaultButtonKeys.CANCEL)
			{
				assertEquals(com.qwirx.data.Cursor.NEW, 
					grid.getCursor().getPosition());
				assertTrue(grid.getCursor().isDirty());
			}
			else
			{
				assertEquals("Cursor should be positioned at " +
					opt_AttemptedPosition + " after clicking " +
					response_button, opt_AttemptedPosition,
					grid.getCursor().getPosition());
				assertFalse("Cursor should no longer be dirty after " +
					"clicking " + response_button,
					grid.getCursor().isDirty());
			}
		},
		"Moving off the NEW row and clicking " + response_button +
		" should have sent these events to the Cursor",
		false, // opt_continue_if_events_not_sent
		function (event) // opt_eventHandler
		{
			if (event.type == com.qwirx.data.Cursor.Events.BEFORE_DISCARD ||
				event.type == com.qwirx.data.Cursor.Events.DISCARD ||
				event.type == com.qwirx.data.Cursor.Events.MOVE_TO)
			{
				assertEquals("The requested position should be stored " +
					"in the " + event.type + " event object",
					opt_AttemptedPosition, event.getNewPosition());
			}
			
			if (event.type == com.qwirx.data.Cursor.Events.SAVE)
			{
				assertEquals("The SAVE event's position should indicate " +
					"the position of the newly created row", new_row_position,
					event.getPosition());
			}
			else if (event.type == com.qwirx.data.Cursor.Events.MOVE_TO)
			{
				// After SAVE, so the new row is already in the datasource.
				// But the movement is from NEW to a row that really exists,
				// otherwise we lost (or duplicated) a movement event!
				assertEquals("The previous cursor position should be " +
					"stored in the MOVE_TO event object", "NEW",
					event.getPosition());
				// Note: event.getNewPosition() was tested above
				/*
				assertEquals("The new cursor position should be stored " +
					"in the MOVE_TO event", attempted_position,
					event.getPosition());
				*/
			}
			
			event.stopPropagation();
			return false; // stop propagation of the event to the default handlers
		});
	
	return actual_events;
}

function test_grid_create_new_row_then_discard_2()
{
	var grid = initGrid(ds);
	var oldCount = ds.getCount();
	
	assert_setup_modified_grid_row(grid, grid.nav_.newButton_,
		com.qwirx.data.Cursor.NEW);
	assert_grid_response_to_dirty_dialog(grid,
		goog.ui.Dialog.DefaultButtonKeys.CANCEL /* response_button */,
		[] /* expected_cursor_events */);
	assertEquals("There should still be " + oldCount + " real data rows, " +
		"and one new row, accessible via the grid", oldCount + 1,
		grid.getRowCount());
	assertEquals(com.qwirx.data.Cursor.NEW, grid.getCursor().getPosition());
	
	assert_setup_modified_grid_row(grid, grid.nav_.newButton_,
		com.qwirx.data.Cursor.NEW);
	assert_grid_response_to_dirty_dialog(grid,
		goog.ui.Dialog.DefaultButtonKeys.CONTINUE /* response_button */,
		[
			com.qwirx.data.Cursor.Events.DISCARD,
			com.qwirx.data.Cursor.Events.MOVE_TO
		] /* expected_cursor_events */);
	assertEquals("There should still be " + oldCount + " real data rows " +
		"and no new rows, accessible via the grid", oldCount,
		grid.getRowCount());
	assertEquals(oldCount - 1, grid.getCursor().getPosition());
}

function assert_grid_create_new_row_then_save_and_move(grid, eventingCallback,
	opt_AttemptedPosition)
{
	var oldCount = ds.getCount();
	
	assert_setup_modified_grid_row(grid, grid.nav_.newButton_,
		com.qwirx.data.Cursor.NEW);
	assert_grid_response_to_dirty_dialog(grid,
		goog.ui.Dialog.DefaultButtonKeys.SAVE,
		[
			com.qwirx.data.Cursor.Events.SAVE,
			com.qwirx.data.Cursor.Events.MOVE_TO
		],
		eventingCallback, opt_AttemptedPosition);
	
	assertEquals("There should now be " + oldCount + " real data rows, " +
		"and no new rows, accessible via the grid", oldCount + 1,
		grid.getRowCount());
	assertEquals(opt_AttemptedPosition, grid.getCursor().getPosition());
}

function test_grid_create_new_row_then_save_and_move()
{
	var grid = initGrid(ds);
	assert_grid_create_new_row_then_save_and_move(grid, function()
		{
			com.qwirx.test.FakeClickEvent.send(grid.nav_.prevButton_);
		}, ds.getCount() - 1 /* opt_AttemptedPosition */);
	assert_grid_create_new_row_then_save_and_move(grid, function()
		{
			com.qwirx.test.FakeClickEvent.send(grid.nav_.firstButton_);
		}, 0 /* opt_AttemptedPosition */);

	// TODO what happens if we sneak in changes while the modal dialog is open?
	// TODO what happens if we discard without navigating (opt_newPosition is null)
	// TODO what happens if we save changes without navigating (opt_newPosition is null)
	// Do we end up positioned in the right place, with the right number of
	// rows displayed?
}

// TODO test grid keyboard event handling: tab, shift-tab, cursor keys, enter, escape

function assert_grid_create_new_row_then_save_without_moving(grid,
	expectedOldPosition, expectedNewPosition)
{
	var expect_move_event = (expectedOldPosition != expectedNewPosition);
	var received_move_event = undefined;
	
	var actual_events = com.qwirx.test.assertEvents(grid.getCursor(),
		[ // expected_cursor_events
			com.qwirx.data.Cursor.Events.SAVE,
			com.qwirx.data.Cursor.Events.MOVE_TO
		],
		function()
		{
			goog.testing.events.fireKeySequence(grid.getElement(), 13);
			
			assertEquals("Cursor should be positioned at " +
				expectedNewPosition + " after pressing Enter",
				expectedNewPosition, grid.getCursor().getPosition());
			assertFalse("Cursor should no longer be dirty after " +
				"pressing Enter", grid.getCursor().isDirty());
		},
		"Pressing Enter on the NEW row should have sent these events to " +
		"the Cursor",
		expect_move_event ? false : true, // opt_continue_if_events_not_sent
		function (event) // opt_eventHandler
		{
			if (event.type == com.qwirx.data.Cursor.Events.SAVE)
			{
				// The "location" of a SAVE event is the newly created row
				assertEquals("The cursor position at SAVE time should be " +
					"stored in the event object", expectedNewPosition,
					event.getPosition());
			}
			
			if (event.type == com.qwirx.data.Cursor.Events.MOVE_TO)
			{
				received_move_event = event;
				
				// But the "location" of a MOVE_TO event is the row that
				// we were originally positioned on, i.e. the NEW row.
				assertEquals("The cursor position at SAVE time should be " +
					"stored in the event object", expectedOldPosition,
					event.getPosition());
				assertEquals("The requested position should be stored " +
					"in the event object", expectedNewPosition,
				 	event.getNewPosition());
			}
		});
	
	if (expect_move_event)
	{
		assertNotUndefined("Should have received a MOVE_TO event from " +
			expectedOldPosition + " to " + expectedNewPosition,
			received_move_event);
	}
	else
	{
			assertUndefined("Should NOT have received any MOVE_TO event",
				received_move_event);
	}

	assertFalse("Cursor should be clean after pressing Enter to save the " +
		"modified row data", grid.getCursor().isDirty());
	assertEquals("Grid should be positioned on the newly saved row",
		expectedNewPosition, grid.getCursor().getPosition());
}

function test_grid_modify_existing_row_then_save_without_moving()
{
	var grid = initGrid(ds);
	var oldCount = ds.getCount();
	assert_setup_modified_grid_row(grid, grid.nav_.nextButton_,
		0 /* opt_startPosition */);
	assert_grid_create_new_row_then_save_without_moving(grid,
		0 /* expectedOldPosition */, 0 /* expectedNewPosition */);
	assertEquals("There should now be " + oldCount + " real data rows, " +
		"and no new rows, accessible via the grid", oldCount,
		grid.getRowCount());
}

function test_grid_create_new_row_then_save_without_moving()
{
	var grid = initGrid(ds);
	var oldCount = ds.getCount();
	grid.getCursor().setPosition(1);
	assert_setup_modified_grid_row(grid, grid.nav_.newButton_,
		com.qwirx.data.Cursor.NEW);
	
	// Click on the row again, check that it doesn't throw an exception
	assertEquals(com.qwirx.data.Cursor.NEW, grid.getCursor().getPosition());
	assertEquals("We're positioned on a NEW row, so the grid should have " +
		"one more row than the Datasource", ds.getCount() + 1,
		grid.getRowCount());
	var cell = grid.getCell(0, grid.getRowCount() - 1);
	com.qwirx.test.FakeClickEvent.send(cell.tableCell);
	assertEquals("We should still be positioned on NEW after clicking " +
		"on a cell on the temporary NEW row", com.qwirx.data.Cursor.NEW,
		grid.getCursor().getPosition());
	assertCurrentRowHighlight(grid);
	
	assert_grid_create_new_row_then_save_without_moving(grid,
		com.qwirx.data.Cursor.NEW, oldCount);
	assertEquals("There should now be " + (oldCount + 1) + " real data rows, " +
		"and no new rows, accessible via the grid", oldCount + 1,
		grid.getRowCount());
}

function test_grid_cell_styles()
{
	var grid = initGrid(ds);
	assertEquals('com_qwirx_grid_Grid com_qwirx_grid_NavigableGrid',
		grid.getElement().className);
	assertEquals('fb-grid-data', grid.wrapper.getElement().className);
	assertEquals('fb-grid-data-table', grid.dataTable_.className);
	assertEquals('com_qwirx_grid_Grid_headerRow', grid.headerRow_.className);
	assertEquals('com_qwirx_grid_Grid_CORNER', 
		grid.headerRow_.children[0].className);
	assertEquals('com_qwirx_grid_Grid_COLUMN_HEAD', 
		grid.headerRow_.children[1].className);
	assertEquals('com_qwirx_grid_Grid_COLUMN_HEAD', 
		grid.headerRow_.children[2].className);
	
	var rowCount = ds.getCount();
	for (var i = 0; i < grid.rows_.length; i++)
	{
		var row = grid.rows_[i];
		var tr = row.tableRowElement_;
		assertEquals('com_qwirx_grid_Grid_Row row_' + i, tr.className);
		assertEquals('com_qwirx_grid_Grid_ROW_HEAD', row.tableCell_.className);
		assertEquals("The first cell in a row's table data cells should be " +
			"the th cell", row.tableCell_, row.tableDataCells_[0]);
		for (var j = 1; j < ds.getColumns().length; j++)
		{
			var cell = row.tableDataCells_[j];
			assertEquals('com_qwirx_grid_Grid_MIDDLE col_' + (j-1),
				cell.className);
		}
	}
}

// TODO a "row count change" is not a valid event for a Datasource to send,
// because the receiver has no idea which rows have been added or removed,
// so it doesn't know what to redraw. Remove this event.

// TODO test adding more rows to a grid while scrolled (addRow gridRowIndex
// != dataRowIndex confusion)

// TODO check that updating a row that's being edited is handled
// appropriately (what is appropriate? an exception event?)

// TODO test that scrolling with a modified (new/existing) row doesn't
// lose the modified values.

// TODO test navigation in a grid with uncertain row counts.

// TODO check that only modified/newly visible rows are refreshed on 
// navigation.

// TODO check that row 0 is not updated spuriously on navigation.

// TODO check that the scroll bar is disabled when scrolling is not
// necessary/possible.

// TODO check button and scrollbar enabled/disabled states, navigation
// and scrollbar when the datasource contains no rows, or all rows
// have been removed. Note: you can move between BOF and EOF even if the
// datasource contains no rows, and you can add a new row if it's editable.
