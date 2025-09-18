/**
 * Admin javascript file for atp wordpress site.
 * This file uses revealing module design pattern
 */
atp = function($) {

    var init = function() {
	    initialiseBuilder();
    };

    /*
     * javascript for Gatsby site builder button
     */
    var initialiseBuilder = function() {

    	var $button = $('#wp-admin-bar-publish-changes a');
    	
    	if ($button.length && $button.is(':visible')) {
    		
	    	//when the button is clicked
    		$button.click(function(e) {
	    		e.preventDefault();
	    		
	    		showModal();
	    		
	    		var requestdata = {
	    			action: 'Custom_build',
	    			security: Custom_vars.nonce,
	    			siteid: $button.attr('href').substr(1)
	    		};
	
	    		//submit data to server		  		
				$.ajax({
					url: Custom_vars.ajax_url,
					data: requestdata,
					cache: false,
					method: "POST",
					timeout: 0
				}).done(function( responsedata ) {
					$('#build-modal .message').text(responsedata);
				}).fail(function(jqXHR, textStatus, errorThrown) {
					console.log('error when retrieving enabled status');
					console.log( jqXHR );
					console.log( textStatus );
					$('#build-modal .message').text('Error running build, please try again later');
				}).always(function() {
					$('#build-modal .pop span.anim').hide();
					$('#build-modal .close').fadeIn();
			    });
				
	    	});
    		
    		//to close the modal
    		$('body').on('click', '#build-modal .close button', function() {
    			$('#build-modal').fadeOut();
    		});
    	}
    	
    	//for preview build
		// var $button2 = $('#wp-admin-bar-preview-changes a');
		
		// console.log('preview');
    	
    	// if ($button2.length && $button2.is(':visible')) {

		// 	console.log('visible');
    		
	    // 	//when the button is clicked
    	// 	$button2.click(function(e) {
		// 		e.preventDefault();
				
		// 		console.log('clicked');
	    		
	    // 		showModal();
	    		
	    // 		var requestdata = {
	    // 			action: 'Custom_preview',
	    // 			security: Custom_vars.nonce,
	    // 			siteid: $button2.attr('href').substr(1)
	    // 		};
	
	    // 		//submit data to server		  		
		// 		$.ajax({
		// 			url: Custom_vars.ajax_url,
		// 			data: requestdata,
		// 			cache: false,
		// 			method: "POST",
		// 			timeout: 0
		// 		}).done(function( responsedata ) {
		// 			$('#build-modal .message').text(responsedata);
		// 		}).fail(function(jqXHR, textStatus, errorThrown) {
		// 			console.log('error when retrieving enabled status');
		// 			console.log( jqXHR );
		// 			console.log( textStatus );
		// 			$('#build-modal .message').text('Error running build, please try again later');
		// 		}).always(function() {
		// 			$('#build-modal .pop span.anim').hide();
		// 			$('#build-modal .close').fadeIn();
		// 	    });
				
	    // 	});
    		
    	// 	//to close the modal
    	// 	$('body').on('click', '#build-modal .close button', function() {
    	// 		$('#build-modal').fadeOut();
    	// 	});
    	// }
    };
    
    /**
     * Display a modal dialog saying that the build is running
     */
    var showModal = function() {
    	$('body').append('<div id="build-modal"><div class="pop"><p class="message">Running build. This should take approximately 5 minutes...</p><span class="anim"></span><p class="close"><button type="button">Close</button></p></div></div>');
    };
    
    return{init:init}//return items that are available outside

}(jQuery);


//document ready
jQuery(function() {
	atp.init();
});


