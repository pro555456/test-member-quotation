 CREATE TABLE `shop_order` (
     `id` int(20) NOT NULL AUTO_INCREMENT,
     `cust_id` int(20) NOT NULL,
     `cust_name` varchar(20) NOT NULL,
     `phone` varchar(10) NOT NULL,
     `address` varchar(200) NOT NULL,
     `status` varchar(1) NOT NULL,
     `total` int(20) NOT NULL,
     `create_date` timestamp NOT NULL DEFAULT current_timestamp(),
     PRIMARY KEY (`id`)
   ) 