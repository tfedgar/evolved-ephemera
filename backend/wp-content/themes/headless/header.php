<?php
/**
 * The Header for our theme.
 *
 * Displays all of the <head> section
 */
?><!doctype html>
<html lang="<?php bloginfo( 'language' ); ?>">
    <head>
        <meta charset="<?php bloginfo( 'charset' ); ?>">
        <meta http-equiv="x-ua-compatible" content="ie=edge">

        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no">

		<?php
	    wp_head();
		?>
    </head>
    <body <?php body_class(); ?>>

		<main>


