goog.provide('com.qwirx.grid.NavigationBar');
goog.provide('com.qwirx.grid.GridNavigationBar');

goog.require('goog.ui.Toolbar');
goog.require('com.qwirx.ui.ToolbarButton');
goog.require('com.qwirx.ui.TextField');
goog.require('com.qwirx.util.Exception');

/**
 * A GUI component that can be placed at the bottom of a data viewer
 * component and used to navigate through the recordset, similar to
 * the arrows at the bottom of a form or datagrid in Access.
 * @param {com.qwirx.data.Cursor} cursor The cursor which this
 *   NavigationBar's buttons will send messages to.
 * @param {goog.ui.ControlRenderer=} opt_renderer The renderer which
 *   this NavigationBar will use to render itself into the DOM.
 *   If not specified, defaults to
 *   {@link com.qwirx.grid.NavigationBar.Renderer}.
 * @param {goog.dom.DomHelper=} opt_domHelper The DOM Helper which
 *   this NavigationBar will use to insert itself into a page's DOM.
 * @constructor
 */
com.qwirx.grid.NavigationBar = function(cursor, opt_renderer,
	opt_domHelper)
{
	com.qwirx.grid.NavigationBar.superClass_.constructor.call(this,
		/* opt_renderer = */ opt_renderer ||
		com.qwirx.grid.NavigationBar.Renderer,
		/* opt_orientation = */ goog.ui.Container.Orientation.HORIZONTAL,
		opt_domHelper);
	
	if (!(cursor instanceof com.qwirx.data.Cursor))
	{
		throw new com.qwirx.grid.NavigationBar.InvalidCursor(cursor);
	}
	
	this.cursor_ = cursor;
	
	goog.events.listen(cursor, com.qwirx.data.Cursor.Events.MOVE_TO,
		com.qwirx.grid.NavigationBar.prototype.onCursorMove, false, this);		
};
goog.inherits(com.qwirx.grid.NavigationBar, goog.ui.Toolbar);

/**
 * An exception thrown by {@link com.qwirx.grid.NavigationBar}
 * when the supplied <code>cursor_</code> argument is not a 
 * {@link com.qwirx.data.Cursor} object.
 * @constructor
 */
com.qwirx.grid.NavigationBar.InvalidCursor = function(cursor)
{
	com.qwirx.util.Exception.call(this, "NavigationBar constructed " +
		"with an invalid cursor: " + cursor);
	this.cursor = cursor;
};
goog.inherits(com.qwirx.grid.NavigationBar.InvalidCursor,
	com.qwirx.util.Exception);

/**
 * Override the prototype in {goog.ui.Container.prototype.handleMouseDown}
 * to avoid mouse events from buttons propagating up to the grid, where
 * they are most definitely not wanted.
 */
com.qwirx.grid.NavigationBar.prototype.handleMouseDown = function(e)
{
	e.stopPropagation();
};

/**
 * Override the prototype in {goog.ui.Container.prototype.handleMouseUp}
 * to avoid mouse events from buttons propagating up to the grid, where
 * they are most definitely not wanted.
 */
com.qwirx.grid.NavigationBar.prototype.handleMouseUp = function(e)
{
	e.stopPropagation();
};

com.qwirx.grid.NavigationBar.Renderer = 
	goog.ui.ToolbarRenderer.getInstance();
/*
	goog.ui.ContainerRenderer.getCustomRenderer(goog.ui.ToolbarRenderer,
		'fb-nav-bar');
*/

/**
 * Returns the number of rows that we move forward when the user
 * clicks on the Next Page button
 * {com#qwirx#grid#NavigationBar#nextPageButton_} or calls 
 * {com#qwirx#grid#NavigationBar#onNextPageButton}.
 */
com.qwirx.grid.NavigationBar.prototype.getPageSize = function()
{
	return this.pageSize_;
};

/**
 * Sets the number of rows that we move forward when the user
 * clicks on the Next Page button
 * {com#qwirx#grid#NavigationBar#nextPageButton_} or calls 
 * {com#qwirx#grid#NavigationBar#onNextPageButton}.
 */
com.qwirx.grid.NavigationBar.prototype.setPageSize = function(newPageSize)
{
	this.pageSize_ = newPageSize;
};

/**
 * Returns the Cursor underlying this {com.qwirx.grid.NavigationBar}.
 * This allows you to perform navigation actions directly on the
 * cursor. They should be reflected in this NavigationBar, except for
 * bugs, but calling this method voids your warranty!
 */
com.qwirx.grid.NavigationBar.prototype.getCursor = function()
{
	return this.cursor_;
};

com.qwirx.grid.NavigationBar.prototype.addButton = function(caption,
	event_handler)
{
	var button = new com.qwirx.ui.ToolbarButton(caption);
	button.render(this.getElement());
	goog.events.listen(button, goog.ui.Component.EventType.ACTION,
		event_handler, false, this);
	return button;
};

com.qwirx.grid.NavigationBar.prototype.createDom = function(tab)
{
	var element = 
		com.qwirx.grid.NavigationBar.superClass_.createDom.call(this,
		tab);

	this.firstButton_ = this.addButton('\u21E4' /* left arrow to bar */,
		this.onFirstButton);
	this.prevPageButton_ = this.addButton('\u219E' /* double left arrow */,
		this.onPrevPageButton);
	this.prevButton_ = this.addButton('\u2190' /* single left arrow */,
		this.onPrevButton);
	
	this.rowNumberField_ = new com.qwirx.ui.TextField(this.cursor_.getPosition());
	this.rowNumberField_.render(this.getElement());
	goog.events.listen(this.rowNumberField_,
		goog.ui.Component.EventType.ACTION,
		this.onRowNumberChange, false, this);

	this.nextButton_ = this.addButton('\u2192' /* single right arrow */,
		this.onNextButton);
	this.nextPageButton_ = this.addButton('\u21A0' /* double right arrow */,
		this.onNextPageButton);
	this.lastButton_ = this.addButton('\u21E5' /* right arrow to bar */,
		this.onLastButton);
	this.newButton_ = this.addButton('\u2217' /* asterisk operator */,
		this.onNewButton);
	
	// Set the initial button enabled states
	this.onCursorMove(undefined /* no event */);
        
	return element;
};

com.qwirx.grid.NavigationBar.prototype.enterDocument = function()
{
	goog.base(this, 'enterDocument');
	com.qwirx.loader.loadCss('goog.closure', 'common.css',
		'toolbar.css');
}

com.qwirx.grid.NavigationBar.prototype.sendEventOnException =
	function(source, callback /* var_args */)
{
	try
	{
		callback.apply(this, Array.prototype.slice.call(arguments, 1));
	}
	catch (exception)
	{
		event = new com.qwirx.util.ExceptionEvent(exception, source);
		var ret = goog.events.dispatchEvent(source /* toolbar button */,
			event);

		// From goog.events.dispatchEvent comments:
		// If anyone called preventDefault on the event object (or
		// if any of the handlers returns false) this will also return
		// false. If there are no handlers, or if all handlers return
		// true, this returns true.
		//
		// A true return value indicates that no handler intercepted
		// the exception event, so rethrow it to help with debugging.
		if (ret)
		{
			if (exception instanceof com.qwirx.data.DiscardBlocked)
			{
				// It's OK for nothing to be listening for this
				// particular exception and the event thrown to report it.
				// The navigation was cancelled, but nobody cared.
				return;
			}
		
			if (exception.message)
			{
				exception.message += " (a com.qwirx.util.ExceptionEvent " +
					"was thrown, but nothing handled it.)";
			}
			
			throw exception;
		}
	}
};

com.qwirx.grid.NavigationBar.prototype.onFirstButton = function(event)
{
	this.sendEventOnException(event.target, function()
	{
		this.cursor_.moveFirst();
	});
};

com.qwirx.grid.NavigationBar.prototype.onPrevPageButton = function(event)
{
	this.sendEventOnException(event.target, function()
	{
		this.cursor_.moveRelative(-this.pageSize_);
	});
};

com.qwirx.grid.NavigationBar.prototype.onPrevButton = function(event)
{
	this.sendEventOnException(event.target, function()
	{
		this.cursor_.moveRelative(-1);
	});
};

com.qwirx.grid.NavigationBar.prototype.onRowNumberChange = function(event)
{
	
};

com.qwirx.grid.NavigationBar.prototype.onNextButton = function(event)
{
	this.sendEventOnException(event.target, function()
	{
		this.cursor_.moveRelative(1);
	});
};

com.qwirx.grid.NavigationBar.prototype.onNextPageButton = function(event)
{
	this.sendEventOnException(event.target, function()
	{
		this.cursor_.moveRelative(this.pageSize_);
	});
};

com.qwirx.grid.NavigationBar.prototype.onLastButton = function(event)
{
	this.sendEventOnException(event.target, function()
	{
		this.cursor_.moveLast();
	});
};

com.qwirx.grid.NavigationBar.prototype.onNewButton = function(event)
{
	this.sendEventOnException(event.target, function()
	{
		this.cursor_.moveNew();
	});
};

/**
 * Responds to events fired by the cursor underlying this
 * {com.qwirx.grid.NavigationBar} by updating the position box
 * value and enabling or disabling navigation buttons.
 * <p>
 * This is a component event, not a browser event, so it will always
 * be dispatched by code that can handle any exceptions appropriately,
 * and doesn't need to catch and convert them to events.
 * @private
 */
com.qwirx.grid.NavigationBar.prototype.onCursorMove = function(event)
{
	var position = this.cursor_.getPosition();
	this.rowNumberField_.setValue(position);
	
	var rows = this.cursor_.getRowCount();
	var BOF = com.qwirx.data.Cursor.BOF;
	var EOF = com.qwirx.data.Cursor.EOF;
	var NEW = com.qwirx.data.Cursor.NEW;
	
	var inData = (position != BOF && position != EOF && position != NEW);
	goog.asserts.assert(rows != 0 || !inData,
		"cannot be positioned in the data when there isn't any");
	
	this.firstButton_.setEnabled(position != 0);
	this.prevPageButton_.setEnabled(position != BOF);
	this.prevButton_.setEnabled(position != BOF);
	this.nextButton_.setEnabled(position != EOF);
	this.nextPageButton_.setEnabled(position != EOF);
	
	// TODO should we allow moving to the end of a dataset of
	// indeterminate size? it might take forever, but if not, it
	// could save the user a lot of time paging through it manually!
	this.lastButton_.setEnabled(rows == -1 || position != rows - 1);
};

com.qwirx.grid.GridNavigationBar = function(cursor, opt_renderer,
	opt_domHelper)
{
	com.qwirx.grid.GridNavigationBar.superClass_.constructor.call(this,
		cursor, opt_renderer, opt_domHelper);
};

goog.inherits(com.qwirx.grid.GridNavigationBar,
	com.qwirx.grid.NavigationBar);

