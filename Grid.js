goog.provide('com.qwirx.grid.Grid');

goog.require('com.qwirx.data.Cursor');
goog.require('com.qwirx.loader');
goog.require('com.qwirx.ui.Dialog');
goog.require('com.qwirx.ui.Renderer');
goog.require('com.qwirx.ui.Slider');
goog.require('com.qwirx.util.Array');
goog.require('com.qwirx.util.Enum');
goog.require('goog.ui.Control');
goog.require('goog.editor.SeamlessField');

/** @define {boolean} */ com.qwirx.grid.DEBUG = true;
 
com.qwirx.grid.log = function(var_args)
{
	if (com.qwirx.grid.DEBUG)
	{
		console.log.apply(console, arguments);
	}
};

/**
 * A grid component which displays data loaded from an underlying
 * data source.
 * @todo change the data source to a goog.ds.DataNode.
 * @todo It would be useful to have a GridSource class that can
 * supply columnised, formatted data on demand, maybe asynchronously.
 * @constructor
 */
com.qwirx.grid.Grid = function(datasource, opt_domHelper, opt_renderer)
{
	opt_renderer = opt_renderer || com.qwirx.grid.Grid.RENDERER;
	goog.ui.Control.call(this, opt_domHelper, opt_renderer);
	
	this.dataSource_ = datasource;
	this.cursor_ = new com.qwirx.data.Cursor(datasource);
	this.layout_ = new com.qwirx.ui.BorderLayout(this.getDomHelper());
	
	this.scrollBar_ = new com.qwirx.ui.Slider();
	this.scrollBar_.setOrientation(goog.ui.Slider.Orientation.VERTICAL);
	this.scrollBar_.setMaximum(this.getRowCount());
	// Scrollbar value is inverted: the maximum value is at the top,
	// which is where we want to be initially.
	this.scrollBar_.setValue(this.getRowCount(), 0);
	
	this.wrapper = new goog.ui.Component();
	
	var self = this;
	
	datasource.addEventListener(
		com.qwirx.data.Datasource.Events.ROWS_INSERT,
		function(e) { self.handleDataSourceRowsEvent(e,
			self.handleRowInsert); });
	datasource.addEventListener(
		com.qwirx.data.Datasource.Events.ROWS_UPDATE,
		function(e) { self.handleDataSourceRowsEvent(e,
			self.handleRowUpdate); });
	datasource.addEventListener(
		com.qwirx.data.Datasource.Events.ROWS_DELETE,
		function(e) { self.handleDataSourceRowsEvent(e,
			self.handleRowDelete); });
	this.cursor_.addEventListener(
		com.qwirx.data.Cursor.Events.BEFORE_DISCARD,
		this.handleDirtyMovement, /* capture */ false, this);
	this.cursor_.addEventListener(
		com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE,
		this.handleBeforeOverwriteEvent, /* capture */ false, this);
	
	// focusing a grid isn't very useful and looks ugly in Chrome
	this.setSupportedState(goog.ui.Component.State.FOCUSED, false);
	
	this.drag = com.qwirx.grid.Grid.NO_SELECTION;
	this.dragMode_ = com.qwirx.grid.Grid.DragMode.NONE;
	
	this.scrollOffset_ = { x: 0, y: 0 };
	
	this.isPositionedOnTemporaryNewRow = false;
	this.currentDialog = null;
};

goog.inherits(com.qwirx.grid.Grid, goog.ui.Control);

com.qwirx.grid.Grid.NO_SELECTION = {
	origin: undefined, x1: -1, y1: -1, x2: -1, y2: -1
};

com.qwirx.grid.Grid.RENDERER = new com.qwirx.ui.Renderer(['com_qwirx_grid_Grid']);
	
com.qwirx.grid.Grid.prototype.createDom = function()
{
	var elem = this.element_ = this.dom_.createDom('div',
		this.renderer_.getClassNames(this).join(' '));
	
	elem.style.height = "100%";
	elem.style.width = "100%";
	
	this.addChild(this.layout_, true /* opt_render */);
	this.layout_.addChild(this.scrollBar_, true /* opt_render */, 'EAST');
	this.layout_.addChild(this.wrapper, true /* opt_render */, 'CENTER');
	
	this.wrapper.getElement().className = 'fb-grid-data';
	
	this.dataTable_ = this.dom_.createDom('table',
		{'class': 'fb-grid-data-table'});
	this.dataTable_.id = goog.string.createUniqueString();
	this.wrapper.getElement().appendChild(this.dataTable_);
	
	this.columns_ = [];
	this.rows_ = [];
	this.highlightStyles_ = goog.style.installStyles('', this.element_);
	this.currentRowStyle_ = goog.style.installStyles('', this.element_);
	
	this.scrollOffset_ = {x: 0, y: 0};
};

/**
 * Can't add rows until we enter the document, because we need to
 * know whether they fit inside the container.
 */
com.qwirx.grid.Grid.prototype.enterDocument = function()
{
	goog.base(this, 'enterDocument');
	com.qwirx.loader.loadCss('com.qwirx.grid', 'grid.css');
	com.qwirx.loader.loadCss('goog.closure', 'dialog.css');

	if (!this.cursor_)
	{
		return;
	}
	
	var container = this.wrapper.getElement();
	var containerPos = goog.style.getPageOffset(container);
	var containerBorder = goog.style.getBorderBox(container);	
	
	var columns = this.dataSource_.getColumns();
	var numCols = columns.length;

	var cornerCell = this.dom_.createDom('th',
		{class: 'com_qwirx_grid_Grid_CORNER'});
	cornerCell[com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE] =
		com.qwirx.grid.Grid.CellType.CORNER;
	var colHeadingCells = [cornerCell];
	
	for (var i = 0; i < numCols; i++)
	{
		var columnInfo = columns[i];
		var column = new com.qwirx.grid.Grid.Column(this,
			columnInfo.caption);
		this.columns_.push(column);
		colHeadingCells.push(column.getIdentityNode());
	}
	
	this.headerRow_ = this.dom_.createDom('tr',
		{class: 'com_qwirx_grid_Grid_headerRow'}, colHeadingCells);
	this.dataTable_.appendChild(this.headerRow_);

	goog.events.listen(this, 
		com.qwirx.grid.Grid.Events.ROW_COUNT_CHANGE, this.handleRowCountChange,
		false, this);
	
	// The rows have just been updated and we don't need to update
	// them again, so we delay setting the scroll event handler
	// until after we've done this.

	this.dispatchEvent(new com.qwirx.grid.Grid.Event.RowCountChange(this.getRowCount()));

	this.scrollBar_.addEventListener(goog.ui.Component.EventType.CHANGE,
		this.handleScrollEvent, /* capture */ false, this);
	
	goog.events.listen(this.cursor_, 
		com.qwirx.data.Cursor.Events.MOVE_TO,
		this.handleCursorMove, /* capture */ false, this);
	
	this.keyHandler = new goog.events.KeyHandler(this.getElement());
	goog.events.listen(this.keyHandler, 'key', this.handleKeyEvent,
		/* capture */ false, this);
};

com.qwirx.grid.Grid.prototype.canAddMoreRows = function()
{
	return this.rows_[this.rows_.length - 1].isFullyVisible();
};

/**
 * An internal function that's called by
 * {com.qwirx.grid.Grid#updateRowVisibility} to add more physical (table)
 * rows to the Grid, in order to be able to display more data at a time,
 * for example when the physical (pixel) size of the Grid changes.
 * @private
 */
com.qwirx.grid.Grid.prototype.addRow = function(visible)
{
	var newRowIndex = this.rows_.length;
	var row = new com.qwirx.grid.Grid.Row(this, newRowIndex);
	this.rows_[newRowIndex] = row;
	row.setVisible(visible);
	
	if (visible)
	{
		this.updateGridRow(newRowIndex);
	}
	
	var element = row.getRowElement();
	goog.dom.insertChildAt(this.dataTable_, element,
		newRowIndex + 1 /* for header row */);
	
	// stolen from goog.style.scrollIntoContainerView 
	/*
	if (element.clientHeight == 0)
	{
		throw new Error("A row element with zero height cannot " +
			"be added to a dynamic grid, since the number of " +
			"such rows cannot be calculated.");
	}
	*/
	
	var elementPos = goog.style.getPageOffset(element);
	if (newRowIndex > 1000 || elementPos.y > 10000)
	{
		// emergency brakes!
		throw new Error("Emergency brakes!");
	}
	
	return row;
};

/**
 * @inheritdoc
 */
com.qwirx.grid.Grid.prototype.exitDocument = function()
{
	for (var i = 0; i < this.rows_.length; i++)
	{
		this.dom_.removeNode(this.rows_[i].tableRowElement_);
	}
	
	this.columns_ = [];
	this.rows_ = [];
	
	this.dom_.removeNode(this.headerRow_);
	delete this.headerRow_;
	
	goog.base(this, 'exitDocument');
};

com.qwirx.grid.Grid.ATTR_PREFIX = 'com_qwirx_grid_';
com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE =
	com.qwirx.grid.Grid.ATTR_PREFIX + 'cell_type';
com.qwirx.grid.Grid.TD_ATTRIBUTE_ROW = 
	com.qwirx.grid.Grid.ATTR_PREFIX + 'row';
com.qwirx.grid.Grid.TD_ATTRIBUTE_COL = 
	com.qwirx.grid.Grid.ATTR_PREFIX + 'col';
com.qwirx.grid.Grid.TD_ATTRIBUTE_CELL = 
	com.qwirx.grid.Grid.ATTR_PREFIX + 'cell';

/**
 * Column is a class, not a static index, to allow renumbering and
 * dynamically numbering large grids quickly.
 */
com.qwirx.grid.Grid.Column = function(grid, caption)
{
	this.grid_= grid;
	var th = this.tableCell_ = grid.dom_.createDom('th',
		{class: 'com_qwirx_grid_Grid_COLUMN_HEAD'}, caption);
	th[com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE] =
		com.qwirx.grid.Grid.CellType.COLUMN_HEAD;
	th[com.qwirx.grid.Grid.TD_ATTRIBUTE_COL] = this;
};

com.qwirx.grid.Grid.Column.prototype.getColumnIndex = function()
{
	return goog.array.indexOf(this.grid_.columns_, this);
};

/**
 * @return the DOM node for the cell above the first data cell,
 * which normally displays a column number, and on which the user
 * can click to select the entire column.
 */
com.qwirx.grid.Grid.Column.prototype.getIdentityNode = function()
{
	return this.tableCell_;
};

/**
 * Row is a class, not a static index, to allow renumbering and
 * dynamically numbering large grids quickly.
 * @param {com.qwirx.grid.Grid} grid The grid to which this Row belongs.
 * @param {number} rowIndex The number of this row in the Grid (the index
 * into grid.rows_, which are visible rows, rather than the data).
 */
com.qwirx.grid.Grid.Row = function(grid, rowIndex)
{
	this.grid_ = grid;
	this.columns_ = [];
	
	var th = this.tableCell_ = grid.dom_.createDom('th',
		{class: 'com_qwirx_grid_Grid_ROW_HEAD'}, '');
	th[com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE] =
		com.qwirx.grid.Grid.CellType.ROW_HEAD;
	th[com.qwirx.grid.Grid.TD_ATTRIBUTE_ROW] = this;

	var cells = [th];
	this.tableDataCells_ = cells;
	this.tableRowElement_ = grid.dom_.createDom('tr',
		{class: "com_qwirx_grid_Grid_Row row_" + rowIndex}, cells);
};

/**
 * @return true if the Row is visible in the container.
 * @param {boolean} include_partial true if you want this method to return
 * true if the row is only partially visible (partially outside the
 * container); false if you only want it to return true if the row is entirely
 * visible (fully inside the container).
 */
com.qwirx.grid.Grid.Row.prototype.isVisibleInternal = function(include_partial)
{
	var element = this.getRowElement();
	var elementPos = goog.style.getPageOffset(element);
	
	var container = this.grid_.wrapper.getElement();
	var containerPos = goog.style.getPageOffset(container);
	var containerBorder = goog.style.getBorderBox(container);	
	
	if (elementPos.y + (include_partial ? 0 : element.clientHeight) >
		containerPos.y + container.clientHeight + containerBorder.top)
	{
		// the row (top/bottom) is hidden (not visible)
		return false;
	}
	else
	{
		// the row (top/bottom) is visible
		return true;
	}
};

com.qwirx.grid.Grid.Row.prototype.isFullyVisible = function()
{
	return this.isVisibleInternal(false);
};

com.qwirx.grid.Grid.Row.prototype.isPartiallyVisible = function()
{
	return this.isVisibleInternal(true);
};

com.qwirx.grid.Grid.Cell = function(grid, text, tableCell)
{
	this.grid = grid;
	this.text = text;
	this.tableCell = tableCell;
	this.wrapper = tableCell.children[0];
	tableCell[com.qwirx.grid.Grid.TD_ATTRIBUTE_CELL] = this;
};

com.qwirx.grid.Grid.Cell.prototype.setEditable = function(editable)
{
	this.editable = editable;
	
	if (editable)
	{
		this.editor = new goog.editor.SeamlessField(this.wrapper);
		this.editor.makeEditable();
		this.editor.focus();
		
		this.handleGridCellValueChange_key = goog.events.listen(
			this.editor,
			goog.editor.Field.EventType.DELAYEDCHANGE,
			this.grid.handleGridCellValueChange, /* capture */ false, this);
	}
	else
	{
		goog.events.unlistenByKey(this.handleGridCellValueChange_key);
		this.editor.makeUneditable();
		this.editor.dispose();
	}
};

com.qwirx.grid.Grid.Cell.prototype.isEditable = function()
{
	return this.editable;
};
		
com.qwirx.grid.Grid.Row.prototype.setValues = function(textValues)
{
	var th = this.tableCell_;
	var oldCells = this.tableDataCells_;
	var newCells = [th];
	var columns = [];
	
	for (var i = 0; i < textValues.length; i++)
	{
		var td;
		
		if (i < oldCells.length - 1 /* for header cell */)
		{
			td = oldCells[i + 1 /* for header cell */];
			td.contentWrapper.innerHTML = textValues[i];
		}
		else
		{
			var text = textValues[i];
			var cssClasses = 'com_qwirx_grid_Grid_MIDDLE col_' + i;
			var wrapper = this.grid_.dom_.createDom('div',
				'com_qwirx_grid_Grid_Row_wrapper', textValues[i]);
			// Make sure we can identify the wrapper div in getDragInfo().
			wrapper[com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE] =
				com.qwirx.grid.Grid.CellType.WRAPPER;
			td = this.grid_.dom_.createDom('td', cssClasses, wrapper);
			goog.dom.appendChild(this.tableRowElement_, td);
			td[com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE] =
				com.qwirx.grid.Grid.CellType.MIDDLE;
			td[com.qwirx.grid.Grid.TD_ATTRIBUTE_COL] = this.grid_.columns_[i];
			td[com.qwirx.grid.Grid.TD_ATTRIBUTE_ROW] = this;
			td.contentWrapper = wrapper;
		}
		
		newCells.push(td);
		var cell = new com.qwirx.grid.Grid.Cell(this.grid_, textValues[i], td);
		columns[i] = cell;
	}
	
	for (var i = newCells.length; i < oldCells.length; i++)
	{
		goog.dom.removeNode(oldCells[i]);
	}
	
	this.columns_ = columns;
	this.tableDataCells_ = newCells;
};

/**
 * Modify the contents of a cell in the row. This is a bit of a hack, but
 * hides the internal details of how the Grid renders cells, with a div
 * inside them to enforce row height:
 * http://stackoverflow.com/questions/19282254/how-to-hide-table-row-overflow-take-2/19282721
 */
com.qwirx.grid.Grid.Row.prototype.setCellText = function(cellIndex, text)
{
	var column = this.columns_[cellIndex];
	this.grid_.setEditableCell(column);
	column.wrapper.innerHTML = text;
	this.grid_.editableCell.editor.dispatchEvent(
		goog.editor.Field.EventType.DELAYEDCHANGE);
};

/**
 * @return the DOM node for the cell above the first data cell,
 * which normally displays a column number, and on which the user
 * can click to select the entire column.
 */
com.qwirx.grid.Grid.Row.prototype.getIdentityNode = function()
{
	return this.tableCell_;
};

com.qwirx.grid.Grid.Row.prototype.getRowIndex = function()
{
	return goog.array.indexOf(this.grid_.rows_, this) +
		this.grid_.scrollOffset_.y;
};

com.qwirx.grid.Grid.Row.prototype.getRowElement = function()
{
	return this.tableRowElement_;
};

com.qwirx.grid.Grid.Row.prototype.getColumns = function()
{
	return this.columns_;
};

/**
 * Event handler for any notification from the application that the
 * number of rows (i.e. the result of calling 
 * <code>this.getRowCount()</code> has changed.
 * @param {com.qwirx.grid.Grid.Event.RowCountChange} the event object.
 */
com.qwirx.grid.Grid.prototype.handleRowCountChange = function(e)
{
	if (!this.isInDocument())
	{
		// not in document, nothing to do
		return;
	}
	
	// May change the number of rows
	this.updateRowVisibility();
	
	var rowCount = e.getNewRowCount();
	
	if (this.drag != com.qwirx.grid.Grid.NO_SELECTION)
	{
		this.prepareForSelection();
		
		// if the highlighted range is completely outside the new
		// valid row range, reset it to defaults.
		if (this.drag.y1 >= rowCount && this.drag.y2 >= rowCount)
		{
			this.drag = com.qwirx.grid.Grid.NO_SELECTION;
		}
		// if only the upper limit is outside the range, reset it
		// to be within the range.
		else if (this.drag.y2 > this.drag.y1 && this.drag.y2 > rowCount)
		{
			this.drag.y2 = rowCount - 1;
		}
		else if (this.drag.y1 > this.drag.y2 && this.drag.y1 > rowCount)
		{
			this.drag.y1 = rowCount - 1;
		}
	}
	
	// setValue will reset the mute flag, so we can't suppress it,
	// so let's take advantage of it to call refreshAll for us.
	this.setScroll(this.scrollOffset_.x, this.scrollOffset_.y);
};

/**
 * Sets the scroll position of the grid, updating the scrollbars to
 * match.
 * @todo currently the x value is ignored.
 */
com.qwirx.grid.Grid.prototype.setScroll = function(newScrollX, newScrollY)
{
	var oldScrollOffset = goog.object.clone(this.scrollOffset_);
	var rowCount = this.getRowCount();
	
	// Changing datasource row count or scroll position so that no rows
	// are visible is not allowed. We should always have at least one row
	// visible. So adjust the scroll position here if necessary.
	if (newScrollY >= rowCount)
	{
		if (rowCount == 0)
		{
			newScrollY = 0;
		}
		else
		{
			newScrollY = rowCount - 1;
		}
	}
	
	var fullyVisibleRows = this.getFullyVisibleRowCount();
	var newMax = rowCount - fullyVisibleRows;
	if (newMax < newScrollY)
	{
		// If some rows are hidden, then we have more than enough rows to
		// display all the available data, so we should not allow scrolling
		// to any more than the current scroll position. In a sense we've
		// scrolled too far, but we don't want to arbitrarily scroll around 
		// without permission (do we?)
		com.qwirx.grid.log("scroll newMax adjusted from " + newMax +
			" to " + newScrollY + " to avoid invalidating current position");
		newMax = newScrollY;
	}

	this.scrollOffset_.y = newScrollY;
	
	// if the maximum is reduced to less than the current value,
	// the value will be adjusted to match it, which will trigger
	// a refreshAll(), so we suppress that by muting events.
	this.scrollBar_.rangeModel.setMute(true);
	this.scrollBar_.setMaximum(newMax);
	this.scrollBar_.rangeModel.setMute(false);
	
	var newVal = newMax - newScrollY;
	if (this.scrollBar_.getValue() != newVal)
	{
		// Will send a CHANGE event to the scrollbar, which calls
		// the handleScrollEvent event handler, which calls us again.
		// But it will be a no-op, because neither the scrollOffset_
		// nor the scrollbar value will change that time. So we have
		// to refresh separately, below.
		this.scrollBar_.setValue(newVal);
		com.qwirx.grid.log("scroll offset changed to " + 
			newScrollY + " for " + newVal+"/" + newMax);
	}
	
	if (oldScrollOffset.y != newScrollY)
	{
		// If the scroll offset has changed, then we need to refresh all rows.
		this.refreshAll();
		
		// {refreshAll} no longer updates the highlight rules for us,
		// so we have to do that ourselves.
		this.updateSelection_(/* force */ true);
	}
};

com.qwirx.grid.Grid.prototype.handleDataSourceRowsEvent =
	function(event, handler)
{
	this.handleRowCountChange(
		new com.qwirx.grid.Grid.Event.RowCountChange(
			this.getCursor().getRowCount()));
	
	if (this.isInDocument())
	{
		var rowIndexes = event.getAffectedRows();
		for (var i = 0; i < rowIndexes.length; i++)
		{
			handler.call(this, rowIndexes[i]);
		}
		
		// The last added/updated/removed row might be particularly large,
		// so as to affect the number of rows visible on screen, so we might
		// need to recalculate the scroll bar value and maximum to restore
		// access to all rows.
		this.setScroll(this.scrollOffset_.x, this.scrollOffset_.y);
	}
	else
	{
		// nothing to update! enterDocument will render for us
	}
};

/**
 * Converts row object values to the strings that should be displayed
 * in the Grid.
 * @param {Object} rowObject The object containing the (new) data for this
 * row.
 * @param {Array} column The column description for this column of this grid,
 * should be equal to <code>this.dataSource_.getColumns()[i]</code>.
 * @return {string} to the string that should be displayed in the Grid
 * for this <code>colIndex</code>.
 */
com.qwirx.grid.Grid.prototype.getColumnText = function(rowObject, column)
{
	var value = rowObject[column.name];
	var text;
	
	if (value == null || value == undefined)
	{
		text = "";
	}
	else
	{
		text = value.toString();
	}
	
	return text;
};

com.qwirx.grid.Grid.prototype.updateRowsFromIndex = function(dataRowIndex)
{
	// Calculate the grid row that corresponds to the data source row index,
	// and update that row if visible, and all the remaining ones.
	var scroll = this.scrollOffset_;
	var firstGridRowToUpdate = dataRowIndex - scroll.y;
	
	// TODO if a row is inserted off screen, just change the scroll position
	// to avoid refreshing the entire grid.
	if (firstGridRowToUpdate < 0)
	{
		firstGridRowToUpdate = 0;
	}
	
	var lastGridRowToUpdate = this.rows_.length - 1;
	
	for (var i = firstGridRowToUpdate; i <= lastGridRowToUpdate; i++)
	{
		if (this.rows_[i].isVisible())
		{
			this.updateGridRow(i);
		}
	}
};

/**
 * Adjusts the selection (selected rows) to accommodate rows being
 * added or deleted.
 * 
 * <ul>
 * <li>If the selection is entirely before and does not include the affected 
 * row at all, then we don't need to change it.
 * 
 * <li> If all the selected rows are deleted, then the selection must be
 * reset to {@link com.qwirx.grid.Grid#NO_SELECTION}.
 * 
 * <li> If a row is added on the first row of the selection, it shifts 
 * the selection down.
 * 
 * <li> If any rows in a selection are deleted, then reduce the number
 * of selected rows without changing its starting row.
 * </ul>
 * 
 * @param {number} dataRowIndex The row number at which the rows were
 * added or deleted.
 * 
 * @param {number} amount The number of rows added or deleted.
 */ 
com.qwirx.grid.Grid.prototype.adjustSelectionAround = function(dataRowIndex,
	amount)
{
	if (this.drag != com.qwirx.grid.Grid.NO_SELECTION)
	{
		if (this.drag.y1 < dataRowIndex && this.drag.y2 < dataRowIndex)
		{
			// selection is entirely before and does not include the 
			// affected row at all, so we don't need to change it.
		}
		else if (amount < 0 && this.drag.y1 == dataRowIndex &&
			this.drag.y2 == dataRowIndex)
		{
			// the deleted row is the only remaining row in the selection
			this.drag = com.qwirx.grid.Grid.NO_SELECTION;
		}
		// Adding a row on the first row of the selection shifts it down,
		// but deleting the same row reduces the selection instead
		else if ((amount < 0 && this.drag.y1 <= dataRowIndex) ||
			(amount > 0 && this.drag.y1 < dataRowIndex))
		{
			goog.asserts.assert(this.drag.y2 >= dataRowIndex,
				"the deleted row should be within the selection");
			// selection covers the affected row, so adjust the end point of
			// the selection to end on the same row as before.
			this.drag.y2 += amount;
		}
		else
		{
			goog.asserts.assert((amount < 0 && this.drag.y1 > dataRowIndex) ||
				(amount > 0 && this.drag.y1 >= dataRowIndex),
				"the deleted row should be before the beginning of the selection");
			goog.asserts.assert((amount < 0 && this.drag.y2 > dataRowIndex) ||
				(amount > 0 && this.drag.y2 >= dataRowIndex),
				"the deleted row should be before the end of the selection");
			// selection is after the affected row, so move it up/down
			// by the right amount.
			this.drag.y1 += amount;
			this.drag.y2 += amount;
		}
	}
	
	this.updateSelection_(false);
};

/**
 * Respond to a datasource row being inserted at the given index.
 * This could be by refreshing the row and all subsequent ones, if it's
 * visible, otherwise by updating the scroll position if necessary.
 * If the selection includes the rows immediately before and after the
 * newly inserted rows, then it's adjusted to include the newly added rows
 * as well.
 */
com.qwirx.grid.Grid.prototype.handleRowInsert = function(newRowIndex)
{
	this.updateRowsFromIndex(newRowIndex);
	this.adjustSelectionAround(newRowIndex, 1);
};

/**
 * Handles {com.qwirx.data.Datasource.Events.ROWS_UPDATE} events
 * indirectly via {com.qwirx.grid.Grid.prototype.handleDataSourceRowsEvent}.
 * 
 * Responds to modified row(s) in the data source by fetching the
 * new row data and redrawing the affected rows, if they are visible on
 * screen.
 */
com.qwirx.grid.Grid.prototype.handleRowUpdate = function(dataRowIndex)
{
	var gridRowIndex = dataRowIndex - this.scrollOffset_.y;
	if (dataRowIndex >= 0 && dataRowIndex < this.rows_.length)
	{
		this.updateGridRow(gridRowIndex);
	}
};

/**
 * Handles {com.qwirx.data.Datasource.Events.ROWS_DELETE} events by
 * redrawing the grid rows that are affected by the deletion, and
 * updating the selection if necessary.
 */
com.qwirx.grid.Grid.prototype.handleRowDelete = function(dataRowIndex)
{
	this.updateRowsFromIndex(dataRowIndex);
	this.adjustSelectionAround(dataRowIndex, -1);
};

/**
 * Replace the existing contents of the existing row identified by
 * rowIndex with the latest contents retrieved from the data source.
 */
com.qwirx.grid.Grid.prototype.updateGridRow = function(gridRowIndex)
{
	var scroll = this.scrollOffset_;
	
	var dataSourceRowToRetrieve = gridRowIndex + scroll.y;
	if (dataSourceRowToRetrieve == this.dataSource_.getCount() &&
		this.isPositionedOnTemporaryNewRow)
	{
		dataSourceRowToRetrieve = com.qwirx.data.Cursor.NEW;
	}
	
	var dataObject;
	if (dataSourceRowToRetrieve == this.getCursor().getPosition())
	{
		dataObject = this.getCursor().getCurrentValues();
	}
	else
	{
		dataObject = this.dataSource_.get(dataSourceRowToRetrieve);
	}
	
	// The row is displayed, so we need to update it
	var row = this.rows_[gridRowIndex];
	goog.asserts.assert(row, "Where is row " + gridRowIndex + "?");
	
	var columns = this.dataSource_.getColumns();
	var colValues = [];
	
	var numCols = columns.length;
	for (var i = 0; i < numCols; i++)
	{
		var colText = this.getColumnText(dataObject, columns[i]);
		colValues[i] = colText;
	}
	
	row.setValues(colValues);
};

com.qwirx.grid.Grid.prototype.getVisibleRowCount = function()
{
	for (var i = this.rows_.length - 1; i >= 0; i--)
	{
		if (this.rows_[i].isPartiallyVisible())
		{
			return i + 1;
		}
	}
};

/**
 * @return the number of table rows created to display grid data,
 * minus one, because the last row is usually partly offscreen.
 */
com.qwirx.grid.Grid.prototype.getFullyVisibleRowCount = function()
{
	for (var i = this.rows_.length - 1; i >= 0; i--)
	{
		if (this.rows_[i].isFullyVisible())
		{
			return i + 1;
		}
	}
	
	// there can't be any rows visible
	return 0;
};

com.qwirx.grid.Grid.prototype.getColumnCount = function()
{
	return this.columns_.length;
};

/**
 * All Grid methods should call this method to get the number of rows
 * of data that can be displayed an accessed in the grid. If a subclass
 * overrides this so that the number of rows can be different than that
 * provided by the dataSource, and it detects that the number has changed,
 * it should send a {@link com.qwirx.grid.Grid.Events.ROW_COUNT_CHANGE}
 * event to the Grid, to allow the grid to add or delete rows, and adjust
 * scrolling.
 */
com.qwirx.grid.Grid.prototype.getRowCount = function()
{
	var rowCount = this.dataSource_.getCount();
	
	if (this.isPositionedOnTemporaryNewRow)
	{
		return rowCount + 1;
	}
	else
	{
		return rowCount;
	}
};

/*
com.qwirx.grid.Grid.prototype.getRow = function(rowIndex)
{
	return this.rows_[rowIndex];
};
*/

com.qwirx.grid.Grid.CellType = {
	COLUMN_HEAD: "COLUMN_HEAD",
	ROW_HEAD: "ROW_HEAD",
	MIDDLE: "MIDDLE",
	CORNER: "CORNER",
	WRAPPER: "WRAPPER"
};

com.qwirx.grid.Grid.DragMode = {
	NONE: "NONE",
	TEXT: "TEXT",
	CELLS: "CELLS",
	COLUMNS: "COLUMNS",
	ROWS: "ROWS"
};

/**
 * Stores the old selection state in this.oldSelection_ and
 * prepares a new one in this.drag.
 */
com.qwirx.grid.Grid.prototype.prepareForSelection = function(e)
{
	this.oldSelection_ = goog.object.clone(this.drag);
	if (this.drag == com.qwirx.grid.Grid.NO_SELECTION)
	{
		this.drag = {};
	}
};

com.qwirx.grid.Grid.prototype.handleMouseDown = function(e)
{
	com.qwirx.grid.Grid.superClass_.handleMouseDown.call(this, e);
	
	var info = this.getDragInfo(e);
	if (!info) return;
	
	var newPosition = info.row;
	if (newPosition == this.getCursor().getRowCount() &&
		this.isPositionedOnTemporaryNewRow)
	{
		newPosition = com.qwirx.data.Cursor.NEW;
	}
	
	if (this.cursor_.getPosition() != newPosition)
	{
		this.cursor_.setPosition(newPosition);
	}
	
	this.prepareForSelection();
	this.drag.origin = e.target;
	
	// Remove existing highlight from rows. Highlighted columns
	// will be reset when updateSelection() calls
	// createHighlightRule_() below, so don't waste effort doing it now.

	if (info.cell.type == info.cell.types.COLUMN_HEAD)
	{
		// clicked on a header cell
		this.setAllowTextSelection(false);
		this.dragMode_ = info.drag.modes.COLUMNS;
		this.drag.x1 = this.drag.x2 = info.col;
		this.drag.y1 = 0;
		this.drag.y2 = this.getRowCount() - 1;
	}
	else if (info.cell.type == info.cell.types.ROW_HEAD)
	{
		// clicked on a header cell
		this.setAllowTextSelection(false);
		this.dragMode_ = info.drag.modes.ROWS;
		this.drag.x1 = 0;
		this.drag.x2 = this.getColumnCount() - 1;
		this.drag.y1 = this.drag.y2 = info.row;
	}
	else if (info.cell.type == info.cell.types.MIDDLE)
	{
		this.setAllowTextSelection(true);
		this.setEditableCell(info.tableCell[com.qwirx.grid.Grid.TD_ATTRIBUTE_CELL]);
		this.dragMode_ = info.drag.modes.TEXT;
		this.drag.x1 = this.drag.x2 = info.col;
		this.drag.y1 = this.drag.y2 = info.row;
	}

	this.updateSelection_(false);
		
	return true;
};

/**
 * Replace the contents of the style element that marks highlighted
 * cells when their row has the <code>highlight</code> class. This
 * mechanism means that updating the highlight is O(r+c) instead of
 * O(r*c), because we don't have to visit every cell to apply
 * (or remove) a highlight style to it.
 */
com.qwirx.grid.Grid.prototype.createHighlightRule_ = function()
{
	var builder = new goog.string.StringBuffer();
	
	var x1 = Math.min(this.drag.x1, this.drag.x2);
	var x2 = Math.max(this.drag.x1, this.drag.x2);

	// don't create any rules if x1 == -1, which means there are currently
	// no cell selected
	for (var x = x1; x <= x2 && x1 >= 0; x++)
	{
		builder.append('table#' + this.dataTable_.id + ' > ' +
			'tr.highlight > td.col_' + x + ' { background: #ddf; }');
	}
	
	goog.style.setStyles(this.highlightStyles_, builder.toString());
};

/**
 * Updates the CSS which applies to this row, to indicate whether
 * it contains any highlighted cells or not. The intersection of
 * the <code>highlight</code CSS class on the row, and the
 * set of highlighted columns, created by the CSS rules created by
 * {#createHighlightRule_}, tells the browser which cells should be
 * rendered in the highlight colour.
 */
com.qwirx.grid.Grid.Row.prototype.setHighlighted = function(enable)
{
	this.grid_.getRenderer().enableClassName(this.getRowElement(),
		'highlight', enable);
};

com.qwirx.grid.Grid.prototype.getCurrentGridRowIndex = function()
{
	var currentDataRowIndex = this.cursor_.getPosition();
	var currentGridRowIndex;
	
	if (this.isPositionedOnTemporaryNewRow)
	{
		return (this.getRowCount() - 1) - this.scrollOffset_.y;
	}
	else
	{
		return currentDataRowIndex - this.scrollOffset_.y;
	}
};

/**
 * Updates the CSS which applies to this row, to indicate whether
 * it is the currently active row, pointed to by the grid's cursor's
 * position, or not. Only one row should be current at any time.
 */
com.qwirx.grid.Grid.prototype.updateCurrentRowHighlight = function()
{
	var currentGridRowIndex = this.getCurrentGridRowIndex();
	var css;
	
	if (currentGridRowIndex >= 0 && 
		currentGridRowIndex < this.rows_.length)
	{
		css = 'table#' + this.dataTable_.id +
			' > tr.row_' + currentGridRowIndex + 
			' > th { background-color: #88f; }';
	}
	else
	{
		css = "";
	}
	
	goog.style.setStyles(this.currentRowStyle_, css);
};

/**
 * @return some useful properties used by all drag/mouse handlers,
 * to reduce code duplication. Returns null if the event's target is
 * not a grid cell, which probably means that you should ignore the
 * event and return, or at least handle it differently.
 */
com.qwirx.grid.Grid.prototype.getDragInfo = function(event)
{
	// com.qwirx.freebase.log("dragging: " + e.type + ": " + e.target);

	var td = event.target;
	
	if (td[com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE] ==
		com.qwirx.grid.Grid.CellType.WRAPPER)
	{
		// clicked on the wrapper div, escalate to parent.
		td = td.parentElement;
	}
	
	var cellType = td[com.qwirx.grid.Grid.TD_ATTRIBUTE_TYPE];

	if (!cellType)
	{
		// maybe an event for the whole table, not a cell?
		return null;
	}

	var info = {
		be: event.browserEvent || event,
		cell: {
			type: cellType,
			types: com.qwirx.grid.Grid.CellType
		},
		drag: {
			mode: this.dragMode_,
			modes: com.qwirx.grid.Grid.DragMode
		},
		tableCell: td
	};
	
	var col = td[com.qwirx.grid.Grid.TD_ATTRIBUTE_COL];
	var row = td[com.qwirx.grid.Grid.TD_ATTRIBUTE_ROW];
	
	info.col = col ? col.getColumnIndex() : null;
	info.row = row ? row.getRowIndex()    : null;
	
	return info;
};
	
/**
 * Update the selection (of cells in the grid) based on a mouse
 * movement event.
 * <p>
 * The way the selection is updated depends on the current
 * {@link com.qwirx.grid.Grid.DragMode selection mode} and the
 * {@link com.qwirx.grid.Grid.CellType cell type} of the cell
 * which the mouse entered.
 *
 * <dl>
 * <dt>0</dt>
 * <dd>Zero (lowest row/column number in grid)</dd>
 * <dt>inf</dt>
 * <dd>Highest row/column number in grid</dd>
 * <dt>x</dt>
 * <dd>The x coordinate of the cell just entered</dd>
 * <dt>y</dt>
 * <dd>The y coordinate of the cell just entered</dd>
 * <dt>min</dt>
 * <dd>The lowest x/y coordinate visible (this.scrollOffset_.x/y)</dd>
 * <dt>max</dt>
 * <dd>The highest x/y coordinate visible (this.scrollOffset_.x/y plus
 * this.visibleArea_.rows/cols)</dd>
 * </dl>
 *
 * <pre>
 *             | CELLS     | COLUMNS   | ROWS      | Drag mode
 *             |-----------|-----------|-----------|
 *             | x2  | y2  | x2  | y2  | x2  | y2  |
 *             |-----|-----|-----|-----|-----|-----|
 * MIDDLE      | x   | y   | x   | inf | inf | y   |
 * COLUMN_HEAD | x   | min | x   | inf | inf | min |
 * ROW_HEAD    | min | y   | min | inf | inf | y   |
 * Cell type   |
 * </pre>
 */
com.qwirx.grid.Grid.prototype.handleDrag = function(e)
{
	// com.qwirx.freebase.log("dragging: " + e.type + ": " + e.target);
	
	var info = this.getDragInfo(e);
	if (!info) return;

	this.prepareForSelection();

	// compute the new x2 and y2 using the above table
	if (info.drag.mode == info.drag.modes.ROWS)
	{
		this.drag.x2 = this.getColumnCount() - 1;
	}
	else if (info.cell.type == info.cell.types.ROW_HEAD)
	{
		this.drag.x2 = this.scrollOffset_.x;
	}
	else if (info.col != null)
	{
		this.drag.x2 = info.col;
	}
	else
	{
		// no change to x2
	}
	
	if (info.drag.mode == info.drag.modes.COLUMNS)
	{
		this.drag.y2 = this.getRowCount() - 1;
	}
	else if (info.cell.type == info.cell.types.COLUMN_HEAD)
	{
		this.drag.y2 = this.scrollOffset_.y;
	}
	else if (info.row != null)
	{
		this.drag.y2 = info.row;
	}
	else
	{
		// no change to y2
	}
	
	this.updateSelection_(false);
};

/**
 * Set the current highlight corners to the provided values, and
 * update the grid highlight CSS to match them.
 *
 * @param x1 The first highlighted column index.
 * @param y1 The first highlighted row index.
 * @param x2 The last highlighted column index.
 * @param y2 The last highlighted row index.
 */
com.qwirx.grid.Grid.prototype.setSelection = function(x1, y1, x2, y2)
{
	this.prepareForSelection();
	this.drag.x1 = x1;
	this.drag.x2 = x2;
	this.drag.y1 = y1;
	this.drag.y2 = y2;
	this.updateSelection_(false);
};

/**
 * Update the CSS highlight rules and classes so that the visible
 * state of the grid matches the selection recorded in this.drag.
 * In order for this to work efficiently, it requires you to store
 * a cloned copy of the old selection parameters (this.drag) in
 * this.oldSelection_ before you update them. It only applies changes
 * to the difference between this.oldSelection_ and this.drag.
 *
 * @param force Force the recreation of highlight rules and classes
 * even if the x or y parameters appear not to have changed between
 * this.oldSelection_ and this.drag. This is useful when scrolling
 * to ensure that any selection changes are brought into view.
 */
com.qwirx.grid.Grid.prototype.updateSelection_ = function(force)
{	
	var oldSel = this.oldSelection_;
	var newSel = this.drag;

	if (!force && oldSel)
	{
		com.qwirx.grid.log("selection changed from " +
			oldSel.x2 + "," + oldSel.y2 + " to " +
			newSel.x2 + "," + newSel.y2);
	}
	
	// changes to y2 are handled by (un)highlighting rows.
	
	if (force || oldSel && (newSel.y1 != oldSel.y1 || newSel.y2 != oldSel.y2))
	{
		var ymin = Math.min(newSel.y1, newSel.y2);
		var ymax = Math.max(newSel.y1, newSel.y2);

		for (var gridRow = 0; gridRow < this.rows_.length; gridRow++)
		{
			var dataRow = this.scrollOffset_.y + gridRow;
			this.rows_[gridRow].setHighlighted(dataRow >= ymin &&
				dataRow <= ymax);
		}
	}	

	// changes to x2 are handled by rewriting the highlight rule.

	if (force || oldSel && (newSel.x1 != oldSel.x1 || newSel.x2 != oldSel.x2))
	{
		this.createHighlightRule_();
	}
	
	this.drag = newSel;
	delete this.oldSelection_;
};

/**
 * Makes a particular cell editable, cancelling any other that was
 * editable before.
 */
com.qwirx.grid.Grid.prototype.setEditableCell = function(newCell)
{
	if (newCell)
	{
		goog.asserts.assertInstanceof(newCell, com.qwirx.grid.Grid.Cell,
			"Only instances of com.qwirx.grid.Grid.Cell may be made editable");
	}
	
	var oldCell = this.editableCell;
	
	if (oldCell && oldCell != newCell)
	{
		oldCell.setEditable(false);
		this.editableCell = undefined;
	}
	
	if (newCell && !this.editableCell)
	{
		this.editableCell = newCell;
		newCell.setEditable(true);
	}
};

com.qwirx.grid.Grid.prototype.logEvent = function(e)
{
	var info = this.getDragInfo(e);
	var col, row;
	
	if (info.cell.type == info.cell.types.ROW_HEAD ||
		info.cell.type == info.cell.types.CORNER)
	{
		col = "H";
	}
	else
	{
		col = info.col;
	}
	
	if (info.cell.type == info.cell.types.COLUMN_HEAD ||
		info.cell.type == info.cell.types.CORNER)
	{
		row = "H";
	}
	else
	{
		row = info.row;
	}
	
	com.qwirx.grid.log("log event " + e.type + ": " + 
		e.target + " [x=" + col + ", y=" + row + "]");
};

/**
 * Turns off cell selection by dragging, and allows text selection
 * again within the editable cell.
 */
com.qwirx.grid.Grid.prototype.handleMouseUp = function(e)
{
	com.qwirx.grid.Grid.superClass_.handleMouseUp.call(this, e);
	
	var info = this.getDragInfo(e);
	if (!info) return;

	this.logEvent(e);

	if (!this.isEnabled()) return;
	this.dragMode_ = info.drag.modes.NONE;
	this.setAllowTextSelection(true);
};

com.qwirx.grid.Grid.prototype.handleMouseOver = function(e)
{
	com.qwirx.grid.Grid.superClass_.handleMouseOver.call(this, e);

	var info = this.getDragInfo(e);
	if (!info) return;

	// this.logEvent(e);

	if (info.drag.mode != info.drag.modes.NONE)
	{
		// entering a different cell, update selection
		this.handleDrag(e);
	}
	
	if (info.drag.mode == info.drag.modes.CELLS)
	{
		if (e.target == this.drag.origin)
		{
			// re-entering the cell where dragging started, restore the
			// original selection, by just re-enabling text selection.

			com.qwirx.grid.log("restored selection, switching to TEXT mode");
			this.dragMode_ = info.drag.modes.TEXT;
			this.setAllowTextSelection(true);
			this.setEditableCell(info.tableCell[com.qwirx.grid.Grid.TD_ATTRIBUTE_CELL]);
		}
		else
		{
			// stop drag events from reaching the browser, where they
			// would result in text selection
			// e.preventDefault();
		}
	}
};

com.qwirx.grid.Grid.prototype.handleMouseOut = function(e)
{
	// this.logEvent(e);
	com.qwirx.grid.Grid.superClass_.handleMouseOut.call(this, e);

	var info = this.getDragInfo(e);
	if (!info) return;

	if (info.drag.mode == info.drag.modes.TEXT &&
		e.target == this.drag.origin)
	{
		// leaving the cell where dragging started, disable text
		// selection to avoid messy interaction with cell selection.

		com.qwirx.grid.log("saving selection, switching to CELLS mode");
		this.dragMode_ = info.drag.modes.CELLS;
		this.setAllowTextSelection(false);
		this.setEditableCell(null);
	}
};

com.qwirx.grid.Grid.prototype.updateRowVisibility = function()
{
	var len = this.rows_.length;
	var recordCount = this.getRowCount();
	
	for (var i = 0; i < len; i++)
	{
		var dataRow = i + this.scrollOffset_.y;
		var visible = (dataRow < recordCount);
		this.rows_[i].setVisible(visible);
	}
	
	// May need to add rows until the last one is not fully visible.
	// However we might not have a stylesheet loaded yet, so the newly
	// added rows might have zero height, and we could add an infinite
	// number of those, so don't do that.
	
	// Stop adding rows when any of the following conditions is true:
	// * the height of the last added row is 0 (unknown)
	// * the last row is not fully visible (falling off the bottom of the grid)
	// * there are enough rows in the grid to display the entire datasource
	for (var i = len; true; i++)
	{
		var lastRow = this.rows_[this.rows_.length - 1];
		if (lastRow && !lastRow.isFullyVisible()) break;
		
		var dataRow = i + this.scrollOffset_.y;
		if (dataRow >= recordCount) break;
		
		var visible = (dataRow < recordCount);
		var addedRow = this.addRow(visible);
		// also populates the new row, if necessary
		
		if (addedRow.getRowElement().clientHeight == 0) break;
	}
};

/**
 * Reloads all the data in all cells in the grid. It does not
 * change the highlight rules. If you want that, you need to call
 * {updateSelection_} separately. We used to do it here, because they
 * are often called together, but that prevents decoupling and
 * eventual replacement of {replaceAll}.
 *
 * @deprecated This is basically an inefficient and ugly hack.
 * The only time you would need to call this is when scrolling
 * by a large amount, and in general we should transfer data from
 * already-loaded rows where possible, rather than discarding
 * unsaved changes, and only reload newly exposed rows.
 */
com.qwirx.grid.Grid.prototype.refreshAll = function()
{
	this.updateRowVisibility();
	
	var len = this.rows_.length;
	
	for (var i = 0; i < len; i++)
	{
		if (this.rows_[i].isVisible())
		{
			this.updateGridRow(i);
		}
	}
	
	this.updateCurrentRowHighlight();
};

com.qwirx.grid.Grid.Row.prototype.setVisible = function(visible)
{
	this.tableRowElement_.style.visibility = visible ? "" : 'hidden';
};

com.qwirx.grid.Grid.Row.prototype.isVisible = function()
{
	return this.tableRowElement_.style.visibility != 'hidden';
};

com.qwirx.grid.Grid.prototype.handleScrollEvent = function(e)
{
	// calls refreshAll() for us
	this.setScroll(this.scrollOffset_.x,
		e.target.getMaximum() - e.target.getValue());
};

com.qwirx.grid.Grid.prototype.getDatasource = function()
{
	return this.dataSource_;
};

/**
 * Responds to a cursor move event by ensuring that the current
 * position row is visible, and the data displayed is correct for
 * the scroll position.
 */
com.qwirx.grid.Grid.prototype.handleCursorMove = function(event)
{
	var events = com.qwirx.data.Cursor.Events;
	var oldScroll = this.scrollOffset_.y;
	var newScroll = oldScroll;
	var firstRowVisible = oldScroll;
	var lastRowVisible = oldScroll + this.getFullyVisibleRowCount() - 1;
	var activeRow = event.newPosition;
	
	var wasPositionedOnTemporaryNewRow = this.isPositionedOnTemporaryNewRow;
	this.isPositionedOnTemporaryNewRow = (activeRow == com.qwirx.data.Cursor.NEW);
	if (wasPositionedOnTemporaryNewRow != this.isPositionedOnTemporaryNewRow)
	{
		// This will cause a row count change, and we need to update the
		// maximum value of the scroll bar before calling setScroll() below.
		this.dispatchEvent(
			new com.qwirx.grid.Grid.Event.RowCountChange(this.getRowCount()));
	}
	
	if (activeRow == com.qwirx.data.Cursor.BOF)
	{
		newScroll = 0;
	}
	else if (activeRow == com.qwirx.data.Cursor.EOF || 
		activeRow == com.qwirx.data.Cursor.NEW)
	{
		// Treat EOF and NEW equally, because moving to NEW changes
		// {@link com.qwirx.grid.Grid#isPositionedOnTemporaryNewRow} and
		// therefore the value of {@link com.qwirx.grid.Grid#getRowCount}.
		// So although the calculation is the same, the result is different.
		var numRows = this.getRowCount();
		if (numRows != null)
		{
			newScroll = numRows - this.getFullyVisibleRowCount();
		}
	}
	else if (activeRow < firstRowVisible)
	{
		newScroll += activeRow - firstRowVisible; // negative
	}
	else if (activeRow > lastRowVisible)
	{
		newScroll += activeRow - lastRowVisible; // positive
	}

	// TODO test what happens if DS has fewer rows than grid
	// TODO test what happens when newScroll < 0
	// TODO test what happens when newScroll > this.dataSource_.getCount()

	this.setScroll(this.scrollOffset_.x, newScroll);
	// Calls refreshAll() for us IF the scroll position changes.
	// However if it does not, then we still need to update the CSS styles
	// to highlight the appropriate row.
	
	if (oldScroll == newScroll)
	{
		this.updateCurrentRowHighlight();
	}
	
	this.dispatchEvent(com.qwirx.grid.Grid.Events.CURSOR_MOVED);
};

/**
 * Called when the Grid receives an event from a {goog.editor.SeamlessField}
 * that the user has modified the value in the field. We must send the new
 * value to the Cursor in this case, so that it knows whether it's clean
 * or dirty.
 */
com.qwirx.grid.Grid.prototype.handleGridCellValueChange = function(e)
{
	var cell = this;
	var gridColumn = cell.tableCell[com.qwirx.grid.Grid.TD_ATTRIBUTE_COL];
	var colIndex = gridColumn.getColumnIndex();
	var dsColumns = this.grid.getDatasource().getColumns();
	var dsColumn = dsColumns[colIndex];
	this.grid.getCursor().setFieldValue(dsColumn.name, cell.wrapper.innerHTML);
};

/**
 * @return the {com.qwirx.data.Cursor} that represents the current or
 * active record in this grid.
 */
com.qwirx.grid.Grid.prototype.getCursor = function()
{
	return this.cursor_;
};

/**
 * Returns the contents of the displayed cell. Intended to help test
 * components that load data into grids, as this is not really a sensible
 * API for extracting data from the underlying datasource!
 * @param {number} x The column number in the grid, offset in the datasource
 * by the horizontal scroll position.
 * @param {number} y The row number in the grid, offset in the datasource
 * by the vertical scroll position.
 * @return an object containing at least two keys, <code>tableCell</code>,
 * the DOM element of the table cell for the specified grid position,
 * and <code>text</code>, the textual content of that cell.
 */
com.qwirx.grid.Grid.prototype.getCell = function(x, y)
{
	if (x == -1 && y == -1)
	{
		return undefined;
	}
	else
	{
		return this.rows_[y].getColumns()[x];
	}
}

/**
 * Attempts to save changes to the currently modified record.
 */
com.qwirx.grid.Grid.prototype.saveChanges = function()
{
	try
	{
		this.getCursor().save();
	}
	catch (e)
	{
		if (e instanceof com.qwirx.data.OverwriteBlocked)
		{
			// already handled by showing a dialog asking user to confirm
			/*
			goog.asserts.assert(this.currentDialog.getContent() ==
				this.getChangedUnderfootMessage());
			*/
		}
		else
		{
			throw(e);
		}
	}
};

/**
 * @return the localised title of the dialog that should be displayed
 * when the user tries to navigate away from a dirty row, without saving
 * changes.
 */
com.qwirx.grid.Grid.prototype.getDirtyDialogTitle = function()
{
	return 'Discard changes to current record?';
};

/**
 * @return the localised content of the dialog that should be displayed
 * when the user tries to navigate away from a dirty row, without saving
 * changes.
 */
com.qwirx.grid.Grid.prototype.getDirtyDialogContent = function()
{
	return "Moving away from a modified record will discard " +
		"your changes.<br /><br />Do you want to move anyway, " +
		"save your changes first, or cancel the movement?";
};

/**
 * @return the localised title of the dialog that should be displayed
 * when the user tries to save changes to a row that was modified
 * independently (e.g. by a different Cursor) in the underlying datasource.
 */
com.qwirx.grid.Grid.prototype.getChangedUnderfootDialogTitle = function()
{
	return 'Overwrite changes to current record?';
};

/**
 * @return the localised message that should be displayed to the user when
 * they try to navigate away from a dirty row (without saving changes).
 */
com.qwirx.grid.Grid.prototype.getChangedUnderfootDialogContent = function()
{
	return "The contents of the current record have changed while you " +
		"were editing it.<br /><br />Do you want to save your version " +
		"of the record (overwriting the other), discard your changes, " +
		"or cancel the movement?";
};

/**
 * Called when the Cursor receives a 
 * {@link com.qwirx.data.Cursor.Events.BEFORE_DISCARD} event, which means
 * that someone tries to move the cursor while it contained dirty data.
 * We can handle this by offering the user the chance to save or discard
 * their changes, or cancel the movement.
 */
com.qwirx.grid.Grid.prototype.handleDirtyMovement = function(e)
{
	goog.asserts.assertInstanceof(e, com.qwirx.data.Cursor.MovementEvent,
		"BEFORE_DISCARD events should always be instances of " +
		"com.qwirx.data.Cursor.MovementEvent");
	var newPosition = e.getNewPosition();
	var cursor = this.getCursor();
	
	var dialog = new com.qwirx.ui.Dialog();
	dialog.setTitle(this.getDirtyDialogTitle());
	dialog.setContent(this.getDirtyDialogContent());
	dialog.setButtonSet(goog.ui.Dialog.ButtonSet.createContinueSaveCancel());
	dialog.setParentEventTarget(this);
	
	goog.events.listen(dialog, goog.ui.Dialog.EventType.SELECT,
		function(e)
		{
			if (e.key == goog.ui.Dialog.DefaultButtonKeys.CANCEL)
			{
				// we already cancelled the movement, so nothing to do
				return;
			}
			else if (e.key == goog.ui.Dialog.DefaultButtonKeys.SAVE)
			{
				cursor.save(true /* suppress MOVE_TO event */);
			}
			else if (e.key == goog.ui.Dialog.DefaultButtonKeys.CONTINUE)
			{
				cursor.discard(newPosition);
			}
			
			if (newPosition !== undefined)
			{
				// Resume the previously cancelled movement
				cursor.setPosition(newPosition);
			}
		}, false /* opt_capt */, this /* opt_handler */);
	
	this.showDialog(dialog);
	
	// Cancel the BEFORE_DISCARD event, so that we can choose how to handle
	// it when the user makes a selection, asynchronously. This will cause
	// Cursor.maybeDiscard to throw an exception, unless we preventDefault
	// as well.
	e.preventDefault();
	return false; 
};

com.qwirx.grid.Grid.prototype.showDialog = function(dialog)
{
	if (this.currentDialog)
	{
		goog.asserts.assert(!this.currentDialog,
			"Cannot open a new dialog when one is already open: " +
			this.currentDialog.getContent());
	}
	
	goog.events.listen(dialog, goog.ui.Dialog.EventType.AFTER_HIDE,
		function(e)
		{
			this.currentDialog = null;
		}, false /* opt_capt */, this /* opt_handler */);
	
	this.currentDialog = dialog;
	dialog.setVisible(true);
};

/**
 * A base class for events that affect the whole grid.
 * @constructor
 */ 
com.qwirx.grid.Grid.Event = function(type)
{
	goog.base(this, type);
};

goog.inherits(com.qwirx.grid.Grid.Event, goog.events.Event);

com.qwirx.grid.Grid.Events = new com.qwirx.util.Enum(
	'ROW_COUNT_CHANGE', 'CHANGES_SAVED', 'CHANGES_DISCARDED',
	'CURSOR_MOVED', 'MOVEMENT_CANCELLED'
);

/**
 * The Grid sends itself this event when it detects that the number of
 * displayed rows has changed. This might be due to the underlying datasource,
 * or moving on or off a NEW record which doesn't exist in the datasource.
 * @constructor
 */ 
com.qwirx.grid.Grid.Event.RowCountChange = function(newRowCount)
{
	goog.base(this, com.qwirx.grid.Grid.Events.ROW_COUNT_CHANGE);
	this.newRowCount = newRowCount;
};

goog.inherits(com.qwirx.grid.Grid.Event.RowCountChange,
	com.qwirx.grid.Grid.Event);

com.qwirx.grid.Grid.Event.RowCountChange.prototype.getNewRowCount = function()
{
	return this.newRowCount;
};

/**
 * Called when the Grid's DOM element receives a keyboard event, for example
 * <code>key</code>, which might indicate that a significant key such as
 * <code>Enter</code> has been pressed, which means that we need to save
 * the current record.
 */
com.qwirx.grid.Grid.prototype.handleKeyEvent = function(e)
{
	var cursor = this.getCursor();
	var oldPosition = cursor.getPosition();
	
	// If we've moved onto a new row using cursor keys, then reset
	// the current editable position to the same column of the new row,
	// or failing that the first column.
	var oldCell = this.editableCell;
	var oldColumn = 0;
	if (oldCell)
	{
		oldColumn = oldCell.tableCell[com.qwirx.grid.Grid.TD_ATTRIBUTE_COL].getColumnIndex();
	}
	var newColumn = oldColumn;
	
	var oldGridRowIndex = this.getCurrentGridRowIndex();
	
	if (e.keyCode == goog.events.KeyCodes.ENTER)
	{
		this.saveChanges();
	}
	else if (e.keyCode == goog.events.KeyCodes.ESC)
	{
		cursor.discard();
	}
	else if (e.keyCode == goog.events.KeyCodes.DOWN)
	{
		if (oldPosition == com.qwirx.data.Cursor.EOF)
		{
			// Ignore movement forwards from EOF
		}
		else
		{
			cursor.moveRelative(1);
		}
	}
	else if (e.keyCode == goog.events.KeyCodes.UP)
	{
		if (oldPosition == com.qwirx.data.Cursor.BOF)
		{
			// Ignore movement backwards from BOF
		}
		else
		{
			cursor.moveRelative(-1);
		}
	}
	else if (e.keyCode == goog.events.KeyCodes.TAB)
	{
		newColumn = oldColumn + 1;
	}
	else if (e.keyCode == goog.events.KeyCodes.LEFT)
	{
		newColumn = oldColumn - 1;
	}
	else
	{
		// tell the system that we didn't handle the event
		return true;
	}
	
	if (cursor.getPosition() != com.qwirx.data.Cursor.BOF &&
		cursor.getPosition() != com.qwirx.data.Cursor.EOF)
	{
		// If we've moved onto a new row using cursor keys, then reset
		// the current editable position to the same column of the new row,
		// or failing that the first column.
		
		var newGridRowIndex = this.getCurrentGridRowIndex();
		var newRow = this.rows_[newGridRowIndex];
	
		if (newColumn <= 0)
		{
			newColumn = 0;
		}
		else if (newColumn >= newRow.columns_length)
		{
			newColumn = newRow.columns_length - 1;
		}
		
		if (newGridRowIndex != oldGridRowIndex ||
			newColumn != oldColumn)
		{
			var newCell = this.rows_[newGridRowIndex].columns_[newColumn];
			this.setEditableCell(newCell);
		}
	}
	
	// by default, if we didn't return true above, we did handle the event.
	e.getBrowserEvent().preventDefault();
	return false;
};

/**
 * Called when the Cursor receives a 
 * {@link com.qwirx.data.Cursor.Events.BEFORE_OVERWRITE} event, which means
 * that someone tries to move the cursor while it contained dirty data.
 * We can handle this by offering the user the chance to save or discard
 * their changes, or cancel the movement.
 */
com.qwirx.grid.Grid.prototype.handleBeforeOverwriteEvent = function(e)
{
	goog.asserts.assertInstanceof(e, com.qwirx.data.Cursor.RowEvent,
		"BEFORE_DISCARD events should always be instances of " +
		"com.qwirx.data.Cursor.RowEvent");
	var newPosition = e.getPosition();
	var cursor = this.getCursor();
	
	var dialog = new com.qwirx.ui.Dialog();
	dialog.setTitle(this.getChangedUnderfootDialogTitle());
	dialog.setContent(this.getChangedUnderfootDialogContent());
	dialog.setButtonSet(goog.ui.Dialog.ButtonSet.createContinueSaveCancel());
	dialog.setParentEventTarget(this);
	
	goog.events.listen(dialog, goog.ui.Dialog.EventType.SELECT,
		function(e) // click_handler
		{
			if (e.key == goog.ui.Dialog.DefaultButtonKeys.CANCEL)
			{
				// we already cancelled the save, so nothing to do
				return;
			}
			else if (e.key == goog.ui.Dialog.DefaultButtonKeys.SAVE)
			{
				cursor.save(true /* suppress MOVE_TO event */);
			}
			else if (e.key == goog.ui.Dialog.DefaultButtonKeys.CONTINUE)
			{
				cursor.discard(newPosition);
			}
		}, false /* opt_capt */, this /* opt_handler */);
	
	this.showDialog(dialog);
	return false; 
};
