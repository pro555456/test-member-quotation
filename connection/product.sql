CREATE TABLE `product` (
    `id` int(20) NOT NULL AUTO_INCREMENT,
    `name` varchar(200) NOT NULL,
    `amount` int(20) NOT NULL,
    `inventory` int(20) NOT NULL,
    `status` varchar(1) NOT NULL,
    `description` varchar(200) NOT NULL,
    `img` varchar(1000) NOT NULL,
    `create_date` date NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`)
  ) 